import { loadDbEnv } from "./load-env";
loadDbEnv();

import { createClient } from "@supabase/supabase-js";
import { PLATFORM_SETTINGS } from "./platform-settings-defaults";
import { SUBJECTS } from "./canonical-subjects";

// Production seed (Phase 10 Part 6): the platform settings and the subject
// list, and nothing else. No users, no wallets, no bookings: the fixtures in
// seed.ts are for dev and test only, and a real user must never meet one.
//
// Settings are inserted, never overwritten (`ignoreDuplicates`), so running
// this again after an admin has changed a value in /admin/settings leaves
// their value alone. Subjects are upserted by slug, which only fills in the
// canonical names and order.
//
// Run via `CONFIRM_PROD=1 pnpm db:seed:prod-settings` (docs/LAUNCH.md), never
// directly; load-env refuses without the confirm or with a dev/test ref.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !serviceKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.production.local");

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function check<T>(res: { error: unknown; data?: T | null }, label: string): T {
  if (res.error) throw new Error(`${label}: ${JSON.stringify(res.error)}`);
  return res.data as T;
}

async function main() {
  // Migration 0007 owns the bucket's policies; this only makes sure it exists.
  await admin.storage.createBucket("avatars", { public: true }).catch(() => {});

  check(await admin.from("subjects").upsert(SUBJECTS, { onConflict: "slug" }), "subjects upsert");
  check(
    await admin.from("platform_settings").upsert(PLATFORM_SETTINGS, { onConflict: "key", ignoreDuplicates: true }),
    "settings insert",
  );

  const subjects = check(await admin.from("subjects").select("slug"), "subjects count") as unknown[];
  const settings = check(await admin.from("platform_settings").select("key"), "settings count") as unknown[];
  console.log(`Production seed done: ${subjects.length} subjects, ${settings.length} settings.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
