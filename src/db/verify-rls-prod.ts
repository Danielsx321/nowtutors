import { loadDbEnv } from "./load-env";
loadDbEnv();

import { createClient } from "@supabase/supabase-js";

// Production RLS check (Phase 10 Part 6). Read-only and anonymous: it signs in
// as nobody and writes nothing that could succeed, because production has no
// fixture users to sign in as (verify-rls.ts needs the seeded ones) and must
// never get any. What it proves: a visitor with the public anon key reads none
// of the private tables, can read the public ones without an error, and can't
// write. The signed-in half of the policies was proven on the test project by
// `pnpm db:verify-rls:test`; the migrations are the same files.
//
// Run via `CONFIRM_PROD=1 pnpm db:verify-rls:prod` after the settings seed.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
if (!url || !anonKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");

const PRIVATE = [
  "profiles",
  "wallets",
  "credit_transactions",
  "payments",
  "tutor_payout_details",
  "bookings",
  "session_requests",
  "conversations",
  "messages",
  "notifications",
  "withdrawal_requests",
  "tutor_earnings",
  "audit_log",
  "favourites",
  "student_subjects",
];

let failures = 0;
function assert(cond: boolean, label: string) {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${label}`);
  if (!cond) failures++;
}

async function main() {
  const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

  console.log("anon — private tables return nothing:");
  for (const table of PRIVATE) {
    const { data, error } = await anon.from(table).select("*").limit(1);
    assert(!error && (data ?? []).length === 0, `anon reads 0 from ${table}`);
  }

  console.log("anon — public reads work (tutors may be empty on day one):");
  for (const table of ["tutor_profiles", "public_profiles", "live_tutors"]) {
    const { error } = await anon.from(table).select("*").limit(1);
    assert(!error, `anon can query ${table}`);
  }
  for (const table of ["subjects", "platform_settings"]) {
    const { data, error } = await anon.from(table).select("*");
    assert(!error && (data ?? []).length > 0, `anon reads ${(data ?? []).length} from ${table} (seeded)`);
  }

  console.log("anon — writes are refused:");
  // Probes that change nothing real even if a policy were broken: a throwaway
  // settings key nobody reads, and a profile with no auth user behind it. A
  // probe that gets through is reported so the row can be deleted by hand.
  {
    const key = `rls_check_${crypto.randomUUID().slice(0, 8)}`;
    const { error } = await anon.from("platform_settings").insert({ key, value: 0, description: "rls check" });
    assert(!!error, `anon cannot INSERT into platform_settings${error ? "" : ` (DELETE the row with key ${key})`}`);
  }
  {
    const { error } = await anon.from("profiles").insert({ id: crypto.randomUUID(), email: "rls-check@example.com" });
    assert(!!error, "anon cannot INSERT into profiles");
  }

  if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nProduction RLS check passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
