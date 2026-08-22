import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the SPEC §15 E2E paths.
 *
 * Not wired into the `verify` CI job yet: these tests need a running app AND a
 * seeded Supabase project, and the only project that exists is the shared
 * dev/prod one (PROGRESS.md). Running them there would mutate live rows. CI
 * enablement waits on a disposable test project — see docs/PROGRESS.md.
 *
 * Locally: `pnpm db:seed`, then `pnpm test:e2e`. Set `E2E_BASE_URL` to point at a
 * deployment instead of the dev server.
 *
 * `E2E_CHANNEL=chrome` runs against an installed system browser instead of
 * Playwright's bundled Chromium — the escape hatch for machines where
 * `playwright install` cannot reach the CDN (a VPN client on this one). Unset in
 * CI, which should use the pinned bundled build.
 */
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
        command: "pnpm dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
