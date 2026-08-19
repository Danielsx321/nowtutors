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
  {
    const { data } = await rows(anon.from("tutor_profiles").select("*").limit(1));
    const row = (data[0] ?? {}) as Record<string, unknown>;
    assert(!("paypal_email" in row), "tutor_profiles exposes no paypal_email column");
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

  await student.auth.signOut();

  console.log(failures === 0 ? "\nRLS verification PASSED" : `\nRLS verification FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
