import { loadDbEnv, assertTestProjectRef } from "./load-env";
const dbEnv = loadDbEnv();

import postgres from "postgres";
import { sessionPoolerUrl } from "./session-url";

// Drops the drizzle migration-tracking schema and the entire public schema,
// then recreates public with the grants Supabase's API roles need. Used to
// prove migrations apply cleanly from an empty database (Phase 1 acceptance).
// Run via `pnpm db:reset` (dev) or `pnpm db:reset:test` (disposable test
// project) — never invoke this file directly.
async function main() {
  const url = sessionPoolerUrl();
  if (dbEnv === "test") assertTestProjectRef(url);
  const sql = postgres(url, {
    prepare: false,
    ssl: "require",
    max: 1,
  });
  try {
    await sql.unsafe(`DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;`);
    await sql.unsafe(`DROP SCHEMA IF EXISTS drizzle CASCADE;`);
    await sql.unsafe(`DROP SCHEMA IF EXISTS public CASCADE;`);
    await sql.unsafe(`CREATE SCHEMA public;`);
    await sql.unsafe(
      `GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;`,
    );
    await sql.unsafe(`GRANT ALL ON SCHEMA public TO postgres, service_role;`);
    console.log("Reset complete: public + drizzle schemas dropped and recreated.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
