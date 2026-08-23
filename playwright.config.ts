import { readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { parse } from "dotenv";
import { assertTestProjectRef } from "./src/db/load-env";

/**
 * Playwright config for the SPEC §15 E2E paths.
 *
 * The tests need a running app AND a seeded Supabase project. That project is
 * the disposable `nowtutors-test` one (PR #19) — never the shared dev/prod
 * project, which also serves production. Seed it with `pnpm db:seed:test`, then
 * run `pnpm test:e2e`. Set `E2E_BASE_URL` to point at a deployment instead of
 * the local dev server.
 *
 * Pointing the dev server at the test project is the job of the `--env-file`
 * wrapper below: `next dev` loads `.env.local` (dev/prod) and has no flag to
 * load `.env.test` instead, so the values have to be in the environment before
 * Next starts. The same wrapper supplies NODE_EXTRA_CA_CERTS, without which
 * this machine's Node cannot complete the TLS handshake to Supabase Auth and
 * every sign-in fails as "Invalid email or password".
 *
 * `E2E_CHANNEL=chrome` runs against an installed system browser instead of
 * Playwright's bundled Chromium — the escape hatch for machines where
 * `playwright install` cannot reach the CDN (a VPN client on this one). Unset in
 * CI, which should use the pinned bundled build.
 */

const TEST_ENV_FILE = ".env.test";

// Fail before launching anything if `.env.test` does not actually point at the
// disposable test project. The same guard the `db:*:test` scripts run — an E2E
// run mutates presence, requests and wallet rows, and doing that against the
// project that serves production is the accident worth spending a startup check
// on. Skipped when E2E_BASE_URL is set: that run drives a deployment whose env
// this file does not choose.
if (!process.env.E2E_BASE_URL) {
  const testEnv = parse(readFileSync(TEST_ENV_FILE, "utf8"));
  assertTestProjectRef(
    `${testEnv.DATABASE_URL ?? ""} ${testEnv.NEXT_PUBLIC_SUPABASE_URL ?? ""}`,
  );
}

export default defineConfig({
  testDir: "./tests/e2e",
  // The presence test deliberately waits out a real 2-minute staleness window;
  // no fake clock can substitute, since the threshold lives in Postgres.
  timeout: 5 * 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {}),
      },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `node scripts/with-ca-certs.mjs --env-file=${TEST_ENV_FILE} pnpm dev`,
        url: "http://localhost:3000",
        // NOT reuseExistingServer. A `pnpm dev` already running on 3000 is
        // pointed at the DEV project, and reusing it would silently run the
        // whole suite — presence writes, session requests, wallet reads —
        // against the database that serves production. A port clash is a loud,
        // correct failure; a silently wrong database is not.
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
