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
 * The suite runs against a PRODUCTION BUILD, not `next dev`. Under `next dev`
 * every route compiles on first request, and measured here that meant `GET /`
 * in 73s, `POST /login` in 54s and `POST /tutor` in 38s — slower than the
 * budgets any honest assertion can carry, so runs failed on compile latency
 * while the app was correct. `next build && next start` moves that cost into a
 * one-off build and serves in milliseconds.
 *
 * Pointing the app at the test project is the job of the `--env-file` wrapper
 * below: Next loads `.env.local` (dev/prod) and has no flag to load `.env.test`
 * instead, so the values have to be in the environment before Next starts. That
 * matters twice over for a build — `NEXT_PUBLIC_*` is inlined into the client
 * bundle at BUILD time, so the build itself has to run under the wrapper too,
 * which is why it is inside the same command. The wrapper also supplies
 * NODE_EXTRA_CA_CERTS, without which this machine's Node cannot complete the
 * TLS handshake to Supabase and every sign-in fails as "Invalid email or
 * password".
 *
 * `E2E_CHANNEL=chrome` runs against an installed system browser instead of
 * Playwright's bundled Chromium — the escape hatch for machines where
 * `playwright install` cannot reach the CDN. On this one that download fails
 * with SELF_SIGNED_CERT_IN_CHAIN, which is NOT interception: the CDN serves a
 * genuine DigiCert chain that curl verifies, and Node's own bundled CA store is
 * what cannot complete it. Running the install through `with-ca-certs.mjs`
 * fixes it, and is the better answer than a system browser. Unset in CI, which
 * should use the pinned bundled build.
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
        // Build AND serve inside one wrapped command, so the build inlines the
        // test project's NEXT_PUBLIC_* values rather than .env.local's.
        command: `node scripts/with-ca-certs.mjs --env-file=${TEST_ENV_FILE} sh -c 'pnpm build && pnpm start'`,
        url: "http://localhost:3000",
        // NOT reuseExistingServer. A `pnpm dev` already running on 3000 is
        // pointed at the DEV project, and reusing it would silently run the
        // whole suite — presence writes, session requests, wallet reads —
        // against the database that serves production. A port clash is a loud,
        // correct failure; a silently wrong database is not.
        reuseExistingServer: false,
        // Playwright pipes webServer STDERR only; stdout defaults to "ignore".
        // That hides every `GET /login 200 in 120ms` line Next dev prints, which
        // is precisely the evidence needed to tell an app failure from a dev
        // server that has stopped answering — a distinction a run of this suite
        // has already turned on once. Piping it costs nothing and keeps the
        // server's own account of a failure in the run log.
        stdout: "pipe",
        stderr: "pipe",
        // Covers a full cold `next build` plus `next start`. MEASURED, not
        // guessed: a cold build of this project on this machine took 273s, so
        // this is that number with room for a slower one. It is the only budget
        // here that is large on purpose, and it buys no slack for any assertion
        // — once the server is up, requests are served in milliseconds.
        timeout: 420_000,
      },
});
