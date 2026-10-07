import { loadDbEnv, assertTestProjectRef } from "./load-env";
const dbEnv = loadDbEnv();

import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { sessionPoolerUrl } from "./session-url";
import { SUBJECTS } from "./canonical-subjects";

// Two throwaway accounts for a live two-person check: one approved tutor who
// accepts instant requests and one student holding 100 credits (an instant
// half hour at 20 credits an hour costs 10). Made for the first real video
// session on production after PR #134 (Agora tokens minted in-app), 2026-10-07.
//
// Both carry an obviously fake name and a `@nowtutors.dev` address, and the
// tutor is visible on /tutors while they exist, so remove them as soon as the
// check is done: `--remove` deletes everything the two accounts touched,
// bookings and earnings included, then the accounts themselves.
//
// The password is generated on each create and printed once; nothing in the
// repo knows it. Run via `pnpm db:seed:test-users:test` on the test project,
// or `CONFIRM_PROD=1 pnpm db:seed:test-users:prod` on production, with
// `--remove` after the check. Never invoke this file directly.

if (dbEnv === "test") assertTestProjectRef(sessionPoolerUrl());
if (dbEnv === "dev") throw new Error("Use pnpm db:seed for the dev project; this script is for test and prod only.");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !serviceKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const REMOVE = process.argv.includes("--remove");
const STUDENT_CREDITS = 100;
const TUTOR_RATE = 20;

const TUTOR = {
  email: "test.tutor@nowtutors.dev",
  fullName: "Test Tutor",
  slug: "test-tutor",
  subject: "Algebra",
};
const STUDENT = { email: "test.student@nowtutors.dev", fullName: "Test Student" };

function check<T>(res: { error: unknown; data?: T | null }, label: string): T {
  if (res.error) throw new Error(`${label}: ${JSON.stringify(res.error)}`);
  return res.data as T;
}

async function findUsers(): Promise<{ tutorId?: string; studentId?: string }> {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  const byEmail = new Map(data.users.map((u) => [u.email, u.id]));
  return { tutorId: byEmail.get(TUTOR.email), studentId: byEmail.get(STUDENT.email) };
}

async function create() {
  const existing = await findUsers();
  if (existing.tutorId || existing.studentId) {
    throw new Error("The test accounts already exist. Run with --remove first, then create again.");
  }

  // The admin who signs the student's funding row: the first admin profile.
  const admins = check(
    await admin.from("profiles").select("id").eq("role", "admin").limit(1),
    "admin lookup",
  ) as { id: string }[];
  if (!admins.length) throw new Error("No admin profile found to sign the funding row.");
  const adminId = admins[0].id;

  const subjectSlug = SUBJECTS.find((s) => s.name === TUTOR.subject)?.slug;
  const subject = check(
    await admin.from("subjects").select("id").eq("slug", subjectSlug ?? "").limit(1),
    "subject lookup",
  ) as { id: string }[];
  if (!subject.length) throw new Error(`Subject "${TUTOR.subject}" is not in this database.`);

  const password = randomBytes(9).toString("base64url") + "!1";
  const ids: Record<string, string> = {};
  for (const u of [TUTOR, STUDENT]) {
    const { data, error } = await admin.auth.admin.createUser({
      email: u.email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    ids[u.email] = data.user.id;
  }
  const tutorId = ids[TUTOR.email];
  const studentId = ids[STUDENT.email];
  const now = new Date().toISOString();

  check(
    await admin.from("profiles").upsert(
      [
        { id: tutorId, email: TUTOR.email, role: "tutor", full_name: TUTOR.fullName, display_name: "Test", country: "NG", timezone: "Africa/Lagos", onboarding_completed_at: now },
        { id: studentId, email: STUDENT.email, role: "student", full_name: STUDENT.fullName, display_name: "Test", country: "NG", timezone: "Africa/Lagos", onboarding_completed_at: now },
      ],
      { onConflict: "id" },
    ),
    "profiles upsert",
  );

  check(
    await admin.from("tutor_profiles").upsert(
      {
        user_id: tutorId,
        slug: TUTOR.slug,
        headline: "Test account for a live check",
        about: "This account exists only to test a live session. It will be removed.",
        languages: ["English"],
        hourly_rate_credits: TUTOR_RATE,
        accepts_instant: true,
        approval_status: "approved",
        approved_at: now,
      },
      { onConflict: "user_id" },
    ),
    "tutor_profiles upsert",
  );
  check(
    await admin.from("tutor_subjects").insert({ tutor_id: tutorId, subject_id: subject[0].id, level: "all" }),
    "tutor_subjects insert",
  );

  // Wallets, with the student's credits written through the ledger so the
  // reconcile cron sees balance = sum(ledger).
  check(
    await admin.from("wallets").upsert(
      [
        { user_id: tutorId, credit_balance: 0 },
        { user_id: studentId, credit_balance: STUDENT_CREDITS },
      ],
      { onConflict: "user_id" },
    ),
    "wallets upsert",
  );
  check(
    await admin.from("credit_transactions").insert({
      user_id: studentId,
      delta: STUDENT_CREDITS,
      balance_after: STUDENT_CREDITS,
      type: "admin_adjustment",
      reference_type: "admin",
      description: "Test account funding for a live check",
      created_by: adminId,
    }),
    "credit_transactions insert",
  );

  console.log(`Test accounts created on ${dbEnv}.`);
  console.log(`  tutor:    ${TUTOR.email}  (approved, ${TUTOR_RATE} credits/hr, ${TUTOR.subject}, /tutors/${TUTOR.slug})`);
  console.log(`  student:  ${STUDENT.email}  (${STUDENT_CREDITS} credits)`);
  console.log(`  password for both: ${password}`);
  console.log(`Remove them when the check is done: the same command with --remove.`);
}

async function remove() {
  const { tutorId, studentId } = await findUsers();
  const ids = [tutorId, studentId].filter((v): v is string => Boolean(v));
  if (!ids.length) {
    console.log("Nothing to remove: the test accounts do not exist.");
    return;
  }

  // Child rows first, in FK order (session_requests and earnings point at
  // bookings; viewers at broadcasts; messages at conversations), so the
  // account delete below can't be blocked by anything the live check
  // created. Each step is allowed to find nothing. The first production run
  // on 2026-10-07 stopped on session_requests, hence the full list.
  const steps: [string, () => PromiseLike<{ error: unknown }>][] = [
    ["session_requests (student)", () => admin.from("session_requests").delete().in("student_id", ids)],
    ["session_requests (tutor)", () => admin.from("session_requests").delete().in("tutor_id", ids)],
    ["tutor_earnings", () => admin.from("tutor_earnings").delete().in("tutor_id", ids)],
    ["withdrawal_requests", () => admin.from("withdrawal_requests").delete().in("tutor_id", ids)],
    ["payments", () => admin.from("payments").delete().in("user_id", ids)],
    ["bookings (student)", () => admin.from("bookings").delete().in("student_id", ids)],
    ["bookings (tutor)", () => admin.from("bookings").delete().in("tutor_id", ids)],
    ["credit_transactions", () => admin.from("credit_transactions").delete().in("user_id", ids)],
    ["notifications", () => admin.from("notifications").delete().in("user_id", ids)],
    ["audit_log (actor)", () => admin.from("audit_log").delete().in("actor_id", ids)],
    ["audit_log (target)", () => admin.from("audit_log").delete().in("target_id", ids)],
    ["messages", () => admin.from("messages").delete().in("sender_id", ids)],
    ["conversations (a)", () => admin.from("conversations").delete().in("participant_a", ids)],
    ["conversations (b)", () => admin.from("conversations").delete().in("participant_b", ids)],
    ["broadcast_viewers", () => admin.from("broadcast_viewers").delete().in("user_id", ids)],
    ["broadcasts", () => admin.from("broadcasts").delete().in("tutor_id", ids)],
    ["favourites (student)", () => admin.from("favourites").delete().in("student_id", ids)],
    ["favourites (tutor)", () => admin.from("favourites").delete().in("tutor_id", ids)],
    ["student_subjects", () => admin.from("student_subjects").delete().in("student_id", ids)],
    ["tutor_subjects", () => admin.from("tutor_subjects").delete().in("tutor_id", ids)],
    ["availability_exceptions", () => admin.from("availability_exceptions").delete().in("tutor_id", ids)],
    ["availability_rules", () => admin.from("availability_rules").delete().in("tutor_id", ids)],
    ["tutor_payout_details", () => admin.from("tutor_payout_details").delete().in("tutor_id", ids)],
    ["wallets", () => admin.from("wallets").delete().in("user_id", ids)],
  ];
  for (const [label, run] of steps) {
    const { error } = await run();
    // A table this build doesn't have is fine; anything else is not.
    if (error && !/relation .* does not exist|Could not find the table/i.test(JSON.stringify(error))) {
      throw new Error(`${label}: ${JSON.stringify(error)}`);
    }
  }

  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw new Error(`auth delete ${id}: ${JSON.stringify(error)}`);
  }
  console.log(`Test accounts removed from ${dbEnv} (${ids.length} user${ids.length === 1 ? "" : "s"}).`);
}

(REMOVE ? remove() : create()).catch((err) => {
  console.error(err);
  process.exit(1);
});
