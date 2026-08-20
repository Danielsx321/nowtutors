import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

// Phase 1 acceptance: prove RLS denies cross-user reads with the anon key (and a
// signed-in user), and allows the intended public reads. DEV/local only — needs
// the anon key and the seeded users. Exits non-zero on any failed assertion.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
if (!url || !anonKey) throw new Error("Missing Supabase env for RLS verify");

let failures = 0;
function assert(cond: boolean, label: string) {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${label}`);
  if (!cond) failures++;
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
  await tutor.auth.signOut();

  console.log(failures === 0 ? "\nRLS verification PASSED" : `\nRLS verification FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
