import { loadDbEnv } from "./load-env";
loadDbEnv();

import { createClient } from "@supabase/supabase-js";

// Phase 1 acceptance: prove RLS denies cross-user reads with the anon key (and a
// signed-in user), and allows the intended public reads. Needs the anon key and
// the seeded users. Exits non-zero on any failed assertion.
// Run via `pnpm db:verify-rls` (dev) or `pnpm db:verify-rls:test` — never invoke
// this file directly.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !anonKey) throw new Error("Missing Supabase env for RLS verify");

let failures = 0;
function assert(cond: boolean, label: string) {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${label}`);
  if (!cond) failures++;
}

/** A service-role fixture write that must succeed, or the checks mean nothing. */
function check<T>(res: { error: unknown; data?: T | null }, label: string): T {
  if (res.error) throw new Error(`${label}: ${JSON.stringify(res.error)}`);
  return res.data as T;
}

async function rows(query: PromiseLike<{ data: unknown; error: unknown }>) {
  const { data, error } = await query;
  return { data: (data ?? []) as unknown[], error };
}

async function main() {
  const anon = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("anon — must be DENIED (0 rows, RLS filters):");
  for (const table of ["profiles", "wallets", "credit_transactions", "payments", "tutor_payout_details"]) {
    const { data, error } = await rows(anon.from(table).select("*"));
    assert(!error && data.length === 0, `anon reads 0 from ${table}`);
  }

  console.log("anon — must be ALLOWED (public reads):");
  for (const table of ["tutor_profiles", "subjects", "platform_settings", "public_profiles"]) {
    const { data, error } = await rows(anon.from(table).select("*"));
    assert(!error && data.length > 0, `anon reads ${data.length} from ${table}`);
  }
  {
    const { error } = await rows(anon.from("live_tutors").select("*"));
    assert(!error, "anon can query live_tutors view (no error)");
  }
  let otherUserId: string | undefined;
  {
    const { data } = await rows(anon.from("tutor_profiles").select("*").limit(1));
    const row = (data[0] ?? {}) as Record<string, unknown>;
    assert(!("paypal_email" in row), "tutor_profiles exposes no paypal_email column");
    otherUserId = row.user_id as string | undefined;
  }

  console.log("anon — writes must be DENIED (no session):");
  {
    const { error } = await anon
      .from("profiles")
      .insert({ id: crypto.randomUUID(), email: "x@example.com" });
    assert(!!error, "anon cannot INSERT into profiles");
  }
  {
    const { data, error } = await anon
      .from("profiles")
      .update({ full_name: "hacked" })
      .not("id", "is", null)
      .select("id");
    assert(!!error || (data ?? []).length === 0, "anon cannot UPDATE profiles");
  }
  {
    const { error } = await anon
      .from("tutor_profiles")
      .insert({ user_id: otherUserId ?? crypto.randomUUID(), slug: "x", hourly_rate_credits: 1 });
    assert(!!error, "anon cannot INSERT into tutor_profiles");
  }

  console.log("authenticated student — scoped to own rows:");
  const student = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signIn, error: signErr } = await student.auth.signInWithPassword({
    email: "student1@nowtutors.dev",
    password: "Password123!",
  });
  if (signErr || !signIn.user) {
    console.error("Could not sign in seeded student1 — run `pnpm db:seed` first.", signErr);
    process.exit(1);
  }
  const uid = signIn.user.id;

  {
    const { data } = await rows(student.from("profiles").select("id"));
    assert(data.length === 1 && (data[0] as { id: string }).id === uid, "student sees only own profile");
  }
  {
    const { data } = await rows(student.from("wallets").select("user_id"));
    assert(
      data.length === 1 && (data[0] as { user_id: string }).user_id === uid,
      "student sees only own wallet",
    );
  }
  {
    const { data } = await rows(student.from("bookings").select("student_id, tutor_id"));
    const onlyMine = data.every((b) => (b as { student_id: string }).student_id === uid);
    assert(onlyMine, `student sees only own bookings (${data.length})`);
  }
  {
    const { data } = await rows(student.from("tutor_payout_details").select("*"));
    assert(data.length === 0, "student (non-tutor) sees 0 payout rows");
  }

  console.log("wrong-user writes must be DENIED (student acting on others):");
  if (otherUserId) {
    const { data, error } = await student
      .from("profiles")
      .update({ full_name: "hacked" })
      .eq("id", otherUserId)
      .select("id");
    assert(!error && (data ?? []).length === 0, "student cannot UPDATE another user's profile");
  }
  // profiles_guard (0003, widened for the trusted server in 0016): a signed-in
  // user still can't escalate their own role or touch their own suspension.
  {
    const { error } = await student.from("profiles").update({ role: "admin" }).eq("id", uid);
    assert(!!error, "student cannot promote themselves to admin (profiles_guard)");
  }
  {
    const { error } = await student.from("profiles").update({ is_suspended: true }).eq("id", uid);
    assert(!!error, "student cannot change their own is_suspended (profiles_guard)");
  }
  {
    const { data } = await rows(student.from("profiles").select("role, is_suspended").eq("id", uid));
    const me = data[0] as { role: string; is_suspended: boolean } | undefined;
    assert(me?.role === "student" && me.is_suspended === false, "student1 is still an unsuspended student");
  }
  {
    // WITH CHECK (user_id = auth.uid()) must reject a spoofed owner id.
    const { error } = await student
      .from("tutor_profiles")
      .insert({ user_id: otherUserId ?? uid, slug: `x-${uid}`, hourly_rate_credits: 1 });
    assert(!!error, "student cannot INSERT tutor_profiles for another user (WITH CHECK)");
  }

  console.log("student_subjects — owner only:");
  {
    // Interests seeded for student1 — the owner reads only their own rows.
    const { data, error } = await rows(student.from("student_subjects").select("student_id"));
    const onlyMine = data.every((r) => (r as { student_id: string }).student_id === uid);
    assert(!error && onlyMine, `student sees only own interests (${data.length})`);
  }
  if (otherUserId) {
    const { error } = await student
      .from("student_subjects")
      .insert({ student_id: otherUserId, subject_id: crypto.randomUUID() });
    assert(!!error, "student cannot INSERT an interest for another user");
  }

  await student.auth.signOut();

  console.log("approved tutor — cannot self-approve or edit others:");
  const tutor = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: tSignIn, error: tErr } = await tutor.auth.signInWithPassword({
    email: "tutor1@nowtutors.dev",
    password: "Password123!",
  });
  if (tErr || !tSignIn.user) {
    console.error("Could not sign in seeded tutor1 — run `pnpm db:seed` first.", tErr);
    process.exit(1);
  }
  const tid = tSignIn.user.id;
  {
    // The tutor_approval_guard trigger (drizzle/0010) must reject a non-admin
    // CHANGE to approval_status. tutor1 is 'approved', so attempt a real change
    // ('rejected') — the trigger fires only on an actual change.
    const { error } = await tutor
      .from("tutor_profiles")
      .update({ approval_status: "rejected" })
      .eq("user_id", tid);
    assert(!!error, "tutor cannot CHANGE own approval_status (approval guard)");
  }
  {
    const { data, error } = await tutor
      .from("tutor_profiles")
      .update({ headline: "changed" })
      .eq("user_id", tid)
      .select("user_id");
    assert(!error && (data ?? []).length === 1, "tutor CAN update own non-approval fields");
  }
  if (otherUserId && otherUserId !== tid) {
    const { data } = await tutor
      .from("tutor_profiles")
      .update({ headline: "hacked" })
      .eq("user_id", otherUserId)
      .select("user_id");
    assert((data ?? []).length === 0, "tutor cannot edit another tutor's profile");
  }
  {
    // profile_reviewed_at is the admin side of the re-review pair (drizzle/0011):
    // a tutor marking their own profile reviewed would defeat the queue.
    const { error } = await tutor
      .from("tutor_profiles")
      .update({ profile_reviewed_at: new Date().toISOString() })
      .eq("user_id", tid);
    assert(!!error, "tutor cannot set own profile_reviewed_at (approval guard)");
  }
  {
    const { error } = await tutor
      .from("tutor_profiles")
      // A UNIQUE value each run, so the assertion tests the guard rather than
      // accidentally writing the value the column already holds (a no-op update
      // does not fire the trigger and would look like a pass/fail at random).
      .update({ approval_note: `self-written note ${Date.now()}` })
      .eq("user_id", tid);
    assert(!!error, "tutor cannot set own approval_note (approval guard)");
  }
  {
    // A tutor must not be able to clear their own re-review flag to dodge review.
    // The change-flag trigger overwrites the submitted value with the old one,
    // so the update "succeeds" but the flag must survive.
    await tutor
      .from("tutor_profiles")
      .update({ headline: "material edit for the flag test" })
      .eq("user_id", tid);
    await tutor
      .from("tutor_profiles")
      .update({ profile_changed_at: null })
      .eq("user_id", tid);
    const { data } = await rows(
      tutor.from("tutor_profiles").select("profile_changed_at").eq("user_id", tid),
    );
    const stillFlagged =
      (data[0] as { profile_changed_at: string | null } | undefined)
        ?.profile_changed_at != null;
    assert(stillFlagged, "tutor cannot clear own profile_changed_at (re-review flag survives)");
  }
  {
    const { data } = await rows(tutor.from("favourites").select("id"));
    assert(data.length === 0, "tutor (non-student) sees 0 favourites");
  }

  // withdrawal_requests: reads unchanged, every client write removed
  // (drizzle/0015). A request row without its withdrawal_hold debit would be a
  // payout of credits nobody set aside, so the only write path is the server
  // action that takes the hold in the same transaction (SPEC §5, §7.11).
  console.log("withdrawal_requests — tutor writes must be DENIED (0015):");
  {
    const { error } = await tutor.from("withdrawal_requests").insert({
      tutor_id: tid,
      amount_credits: 1000,
      amount_usd: "1000.00",
      payout_destination: "attacker@paypal.dev",
    });
    assert(!!error, "tutor cannot INSERT a withdrawal request directly (no hold bypass)");
  }
  {
    const { data, error } = await tutor
      .from("withdrawal_requests")
      .update({ status: "paid" })
      .eq("tutor_id", tid)
      .select("id");
    assert(!!error || (data ?? []).length === 0, "tutor cannot UPDATE withdrawal_requests");
  }
  {
    const { data, error } = await rows(
      tutor.from("withdrawal_requests").select("tutor_id"),
    );
    const onlyMine = data.every((r) => (r as { tutor_id: string }).tutor_id === tid);
    assert(!error && onlyMine, `tutor reads only own withdrawal requests (${data.length})`);
  }
  await tutor.auth.signOut();

  console.log("student cannot write tutor_profiles at all:");
  const student2 = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await student2.auth.signInWithPassword({
    email: "student1@nowtutors.dev",
    password: "Password123!",
  });
  {
    const { data } = await rows(
      student2.from("tutor_profiles").update({ headline: "hacked" }).not("user_id", "is", null).select("user_id"),
    );
    assert(data.length === 0, "student cannot UPDATE any tutor_profiles row");
  }
  {
    const { error } = await student2
      .from("tutor_profiles")
      .insert({ user_id: uid, slug: `student-made-${uid}`, hourly_rate_credits: 10 });
    assert(!!error, "student cannot INSERT a tutor_profiles row for themselves");
  }

  console.log("favourites — owner only:");
  {
    const { data, error } = await rows(student2.from("favourites").select("student_id"));
    const onlyMine = data.every((r) => (r as { student_id: string }).student_id === uid);
    assert(!error && data.length > 0 && onlyMine, `student reads only own favourites (${data.length})`);
  }
  if (otherUserId) {
    const { error } = await student2
      .from("favourites")
      .insert({ student_id: otherUserId, tutor_id: otherUserId });
    assert(!!error, "student cannot INSERT a favourite for another student");
  }
  {
    const { data } = await rows(
      student2.from("favourites").delete().neq("student_id", uid).select("id"),
    );
    assert(data.length === 0, "student cannot DELETE another student's favourites");
  }
  await student2.auth.signOut();

  // ── Messaging and broadcasts: server actions only (drizzle/0018) ──────────
  // drizzle/0005 let a participant rewrite a conversation's participants, edit
  // the other party's messages, insert messages past every server rule, and let
  // ANY signed-in user create a broadcast with a channel of their choosing
  // (which the §9 broadcast token branch reads). Every client write on these
  // four tables is removed; participant and public reads stay (Realtime needs
  // them). A fixture thread is written with the service role and removed after.
  console.log("messaging + broadcasts — client writes must be DENIED (0018):");
  {
    const service = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const idsByEmail = check(
      await service
        .from("profiles")
        .select("id, email")
        .in("email", ["student1@nowtutors.dev", "student2@nowtutors.dev", "tutor1@nowtutors.dev"]),
      "fixture profiles",
    ) as { id: string; email: string }[];
    const idOf = (email: string) => idsByEmail.find((p) => p.email === email)?.id;
    const s1 = idOf("student1@nowtutors.dev");
    const s2 = idOf("student2@nowtutors.dev");
    const t1 = idOf("tutor1@nowtutors.dev");
    if (!s1 || !s2 || !t1) {
      assert(false, "seeded student1, student2 and tutor1 exist for the messaging checks");
    } else {
      // Reuse the pair's thread if one exists (the pair index allows one).
      const existing = check(
        await service
          .from("conversations")
          .select("id")
          .or(`and(participant_a.eq.${s1},participant_b.eq.${t1}),and(participant_a.eq.${t1},participant_b.eq.${s1})`),
        "fixture conversation lookup",
      ) as { id: string }[];
      let conversationId = existing[0]?.id;
      const createdConversation = !conversationId;
      if (!conversationId) {
        const created = check(
          await service
            .from("conversations")
            .insert({ participant_a: s1, participant_b: t1 })
            .select("id")
            .single(),
          "fixture conversation insert",
        ) as { id: string };
        conversationId = created.id;
      }
      const fixtureBody = `rls fixture ${Date.now()}`;
      const message = check(
        await service
          .from("messages")
          .insert({ conversation_id: conversationId, sender_id: t1, body: fixtureBody })
          .select("id")
          .single(),
        "fixture message insert",
      ) as { id: string };

      const signedIn = async (email: string) => {
        const client = createClient(url, anonKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        await client.auth.signInWithPassword({ email, password: "Password123!" });
        return client;
      };
      const s1Client = await signedIn("student1@nowtutors.dev");
      const s2Client = await signedIn("student2@nowtutors.dev");
      const t1Client = await signedIn("tutor1@nowtutors.dev");

      try {
        {
          const { data, error } = await rows(
            s1Client.from("messages").select("id").eq("conversation_id", conversationId),
          );
          assert(!error && data.length >= 1, "participant reads their own thread's messages");
        }
        {
          const { data, error } = await rows(
            s2Client.from("messages").select("id").eq("conversation_id", conversationId),
          );
          assert(!error && data.length === 0, "non-participant reads 0 messages from another thread");
        }
        {
          const { data, error } = await rows(
            s2Client.from("conversations").select("id").eq("id", conversationId),
          );
          assert(!error && data.length === 0, "non-participant reads 0 rows of another conversation");
        }
        {
          const { error } = await s1Client
            .from("conversations")
            .insert({ participant_a: s1, participant_b: s2 });
          assert(!!error, "student cannot INSERT a conversation directly");
        }
        {
          // Without this, a thread the INSERT check above let through would make
          // the rewrite fail on the pair index (23505) and pass for the wrong
          // reason, which is exactly what happened on the first proof run.
          await service
            .from("conversations")
            .delete()
            .or(`and(participant_a.eq.${s1},participant_b.eq.${s2}),and(participant_a.eq.${s2},participant_b.eq.${s1})`);
          const { error: rewriteError } = await s1Client
            .from("conversations")
            .update({ participant_b: s2 })
            .eq("id", conversationId);
          console.log(
            `      (participant rewrite attempt: ${(rewriteError as { code?: string } | null)?.code ?? "no error"})`,
          );
          const after = check(
            await service
              .from("conversations")
              .select("participant_a, participant_b")
              .eq("id", conversationId)
              .single(),
            "conversation re-read",
          ) as { participant_a: string; participant_b: string };
          const pair = [after.participant_a, after.participant_b];
          assert(
            pair.includes(t1) && !pair.includes(s2),
            "participant cannot rewrite a conversation's participants",
          );
        }
        {
          await s1Client.from("messages").update({ body: "tampered" }).eq("id", message.id);
          const after = check(
            await service.from("messages").select("body").eq("id", message.id).single(),
            "message re-read",
          ) as { body: string };
          assert(after.body === fixtureBody, "participant cannot edit the other party's message");
        }
        {
          const { error } = await s1Client
            .from("messages")
            .insert({ conversation_id: conversationId, sender_id: s1, body: "direct insert" });
          assert(!!error, "participant cannot INSERT a message directly (server actions only)");
        }
        {
          const { error } = await s1Client.from("broadcasts").insert({
            tutor_id: s1,
            title: "rls student broadcast",
            agora_channel: `session_${crypto.randomUUID()}`,
          });
          assert(!!error, "student cannot INSERT a broadcast (no chosen agora_channel)");
        }
        {
          const { error } = await t1Client.from("broadcasts").insert({
            tutor_id: t1,
            title: "rls direct broadcast",
            agora_channel: `broadcast_${crypto.randomUUID()}`,
          });
          assert(!!error, "tutor cannot INSERT a broadcast directly (server actions only)");
        }
        // The broadcast id is random, so a foreign-key error (23503) would also
        // come back. Only a privilege or policy refusal (42501) proves the write
        // path is closed; anything else means the insert got past RLS.
        {
          const { error } = await anon
            .from("broadcast_viewers")
            .insert({ broadcast_id: crypto.randomUUID(), user_id: null });
          assert(
            (error as { code?: string } | null)?.code === "42501",
            `anon cannot INSERT broadcast_viewers (got ${(error as { code?: string } | null)?.code ?? "no error"})`,
          );
        }
        {
          const { error } = await s1Client
            .from("broadcast_viewers")
            .insert({ broadcast_id: crypto.randomUUID(), user_id: s1 });
          assert(
            (error as { code?: string } | null)?.code === "42501",
            `student cannot INSERT broadcast_viewers directly (got ${(error as { code?: string } | null)?.code ?? "no error"})`,
          );
        }
        // message-attachments (drizzle/0019): private, no client policies. Even a
        // participant can't read an object directly; only a server-signed link can.
        {
          const { data: bucket } = await service.storage.getBucket("message-attachments");
          assert(
            bucket?.public === false && Number(bucket?.file_size_limit) === 10 * 1024 * 1024,
            "message-attachments bucket is private with a 10 MB limit",
          );
          const objectPath = `${conversationId}/${crypto.randomUUID()}/rls-fixture.png`;
          const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
          const uploaded = await service.storage
            .from("message-attachments")
            .upload(objectPath, png, { contentType: "image/png" });
          assert(!uploaded.error, "service role can upload a fixture attachment");
          try {
            const asParticipant = await s1Client.storage.from("message-attachments").download(objectPath);
            assert(!!asParticipant.error, "participant cannot download an attachment directly (signed links only)");
            const asOutsider = await s2Client.storage.from("message-attachments").download(objectPath);
            assert(!!asOutsider.error, "non-participant cannot download another thread's attachment");
            const asAnon = await anon.storage.from("message-attachments").download(objectPath);
            assert(!!asAnon.error, "anon cannot download an attachment");
            const listed = await s2Client.storage.from("message-attachments").list(conversationId);
            assert(
              !!listed.error || (listed.data ?? []).length === 0,
              "non-participant cannot list a thread's attachments",
            );
            const direct = await s1Client.storage
              .from("message-attachments")
              .upload(`${conversationId}/${crypto.randomUUID()}/direct.png`, png, { contentType: "image/png" });
            assert(!!direct.error, "signed-in user cannot upload into message-attachments directly");
          } finally {
            await service.storage.from("message-attachments").remove([objectPath]);
          }
        }
      } finally {
        await Promise.all([
          s1Client.auth.signOut(),
          s2Client.auth.signOut(),
          t1Client.auth.signOut(),
        ]);
        // Anything a still-open hole let through, then the fixture itself.
        await service
          .from("broadcasts")
          .delete()
          .in("title", ["rls student broadcast", "rls direct broadcast"]);
        await service
          .from("messages")
          .delete()
          .eq("conversation_id", conversationId)
          .in("body", ["direct insert", fixtureBody, "tampered"]);
        await service
          .from("conversations")
          .update({ participant_a: s1, participant_b: t1 })
          .eq("id", conversationId);
        await service
          .from("conversations")
          .delete()
          .or(`and(participant_a.eq.${s1},participant_b.eq.${s2}),and(participant_a.eq.${s2},participant_b.eq.${s1})`);
        if (createdConversation) {
          await service.from("conversations").delete().eq("id", conversationId);
        }
      }
    }
  }

  // ── Same-email identity linking (SPEC §7.1) ────────────────────────────────
  // The no-duplicate-accounts guarantee for "Google sign-in on an existing
  // password account" rests on a Supabase dashboard setting ("Allow multiple
  // accounts with the same email address" must stay OFF). The dashboard flag
  // itself is only readable through the Management API, which needs a personal
  // access token we deliberately do not ship. So assert the OBSERVABLE property
  // instead — that the auth layer refuses a second account for an email that
  // already exists. If someone flips the setting on, this fails loudly here
  // instead of silently producing duplicate profiles months later.
  console.log("same-email linking — duplicate accounts must be REJECTED:");
  {
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const email = `linkcheck-${Date.now()}@nowtutors.dev`;
    const first = await admin.auth.admin.createUser({
      email,
      password: "Password123!",
      email_confirm: true,
    });
    if (first.error) {
      assert(false, `could not create probe user: ${first.error.message}`);
    } else {
      const dup = await admin.auth.admin.createUser({
        email,
        password: "Password123!",
        email_confirm: true,
      });
      assert(
        !!dup.error,
        "a second account with an existing email is rejected (same-email linking ON)",
      );
      if (!dup.error) {
        console.log(
          "      ^ Supabase is allowing duplicate emails. Turn OFF 'Allow multiple\n" +
            "        accounts with the same email address' (Authentication -> Sign In /\n" +
            "        Providers). Until then Google sign-in on an existing email creates a\n" +
            "        SECOND account instead of linking (SPEC §7.1). See RUNBOOK.",
        );
        await admin.auth.admin.deleteUser(dup.data.user!.id);
      }
      await admin.auth.admin.deleteUser(first.data.user!.id);
    }
  }

  console.log(failures === 0 ? "\nRLS verification PASSED" : `\nRLS verification FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
