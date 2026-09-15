import { readFileSync } from "node:fs";
import { expect, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { parse } from "dotenv";
import postgres from "postgres";
import { assertTestProjectRef } from "../../src/db/load-env";

/**
 * SPEC §15 E2E path 7: **a broadcast is watchable by two viewers**, the second
 * half of Phase 9 acceptance (§16).
 *
 *   tutor3 starts a broadcast from /tutor/broadcasts → lands on the host view with
 *   a (fake) camera → student2 and student1 each find it on /live and open it →
 *   each viewer's page is playing the host's video → the host's count reads 2 →
 *   the host ends it → both viewers show "This broadcast has ended".
 *
 * Test project only. Chromium runs with a fake camera and microphone and
 * auto-accepted permission prompts. Real Agora: the token service is pinged first
 * so a sleeping Render instance doesn't eat the join budget.
 *
 * "Playing" is checked on the page itself: some `<video>` the Agora SDK attached
 * has `readyState >= 2` (a decoded frame), which is a picture, not just a join.
 *
 * Preconditions checked, not assumed: tutor3 has no `in_progress` session. Any
 * live broadcast tutor3 was left with by an earlier run is ended first, and every
 * broadcast this test starts is ended afterwards even if it fails.
 */

const TEST_ENV = parse(readFileSync(".env.test", "utf8"));
assertTestProjectRef(`${TEST_ENV.DATABASE_URL ?? ""} ${TEST_ENV.NEXT_PUBLIC_SUPABASE_URL ?? ""}`);

const PASSWORD = process.env.E2E_PASSWORD ?? "Password123!";
const TUTOR_EMAIL = "tutor3@nowtutors.dev";
const VIEWER_EMAILS = ["student2@nowtutors.dev", "student1@nowtutors.dev"];
const TITLE_PREFIX = "E2E broadcast";
const SIGNIN_TIMEOUT_MS = 15_000;
const ACTION_TIMEOUT_MS = 20_000;
/** Token request (a cold token service), Agora join and the first decoded frame. */
const MEDIA_TIMEOUT_MS = 90_000;
/** Presence sync and Agora's user-left, both push events. */
const PUSH_TIMEOUT_MS = 60_000;

test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

const sql = postgres(TEST_ENV.DATABASE_URL!, { prepare: false, max: 1 });
let tutorId: string | undefined;

async function endLeftovers() {
  if (!tutorId) return;
  await sql`
    update broadcasts set status = 'ended', ended_at = now()
     where tutor_id = ${tutorId} and status = 'live'
  `;
  await sql`
    update tutor_profiles set is_live = false, live_mode = null
     where user_id = ${tutorId} and live_mode = 'broadcast'
  `;
}

test.afterAll(async () => {
  await endLeftovers();
  await sql.end({ timeout: 5 });
});

async function signedInPage(
  browser: Browser,
  email: string,
  landing: RegExp,
  options: BrowserContextOptions = {},
): Promise<Page> {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page).toHaveURL(landing, { timeout: SIGNIN_TIMEOUT_MS });
  return page;
}

/** True once any Agora-attached video on the page has a decoded frame. */
async function expectVideoPlaying(page: Page, who: string) {
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          Array.from(document.querySelectorAll("video")).some((v) => v.readyState >= 2),
        ),
      { message: `${who} is playing video`, timeout: MEDIA_TIMEOUT_MS, intervals: [1_000] },
    )
    .toBe(true);
}

test("E2E 7: two signed-in viewers watch one broadcast, and both see it end", async ({ browser, request }) => {
  const [ids] = await sql<{ tutor: string; inSession: number }[]>`
    select p.id as tutor,
           (select count(*)::int from bookings b where b.tutor_id = p.id and b.status = 'in_progress') as "inSession"
      from profiles p where p.email = ${TUTOR_EMAIL}
  `;
  expect(ids?.tutor, "seeded tutor3 exists (pnpm db:seed:test)").toBeTruthy();
  expect(ids.inSession, "tutor3 has no in_progress session").toBe(0);
  tutorId = ids.tutor;
  await endLeftovers();

  // Wake the token service (Render free tier) before anyone waits on a join.
  const ping = await request.get(`${TEST_ENV.AGORA_TOKEN_SERVICE_URL!.replace(/\/+$/, "")}/ping`, {
    timeout: 60_000,
  });
  expect(ping.ok(), `token service /ping answered ${ping.status()}`).toBe(true);

  // 1. The tutor goes live.
  const host = await signedInPage(browser, TUTOR_EMAIL, /\/tutor(\/|$)/, {
    permissions: ["camera", "microphone"],
  });
  await host.goto("/tutor/broadcasts");
  const title = `${TITLE_PREFIX} ${Date.now()}`;
  await host.getByLabel(/^title/i).fill(title, { timeout: ACTION_TIMEOUT_MS });
  await host.getByRole("button", { name: /^go live$/i }).click({ timeout: ACTION_TIMEOUT_MS });
  await expect(host).toHaveURL(/\/broadcast\/[0-9a-f-]{36}$/, { timeout: ACTION_TIMEOUT_MS });
  const broadcastId = host.url().split("/").pop()!;
  await expectVideoPlaying(host, "the host's own preview");

  // 2. Two students find it on /live and open it.
  const viewers: Page[] = [];
  for (const email of VIEWER_EMAILS) {
    const viewer = await signedInPage(browser, email, /\/dashboard(\/|$)/);
    await viewer.goto("/live");
    await viewer.getByRole("link", { name: title }).click({ timeout: ACTION_TIMEOUT_MS });
    await expect(viewer).toHaveURL(new RegExp(`/live/${broadcastId}$`), { timeout: ACTION_TIMEOUT_MS });
    viewers.push(viewer);
  }

  // 3. Both are watching the host's picture, and the host counts both.
  for (const [i, viewer] of viewers.entries()) await expectVideoPlaying(viewer, `viewer ${i + 1}`);
  await expect(host.locator('[data-viewer-count="2"]').first()).toBeVisible({ timeout: PUSH_TIMEOUT_MS });

  // 4. The host ends it for everyone.
  await host.getByRole("button", { name: /^end broadcast$/i }).click({ timeout: ACTION_TIMEOUT_MS });
  await host.getByRole("button", { name: /^end for everyone$/i }).click({ timeout: ACTION_TIMEOUT_MS });
  await expect(host).toHaveURL(/\/tutor\/broadcasts$/, { timeout: ACTION_TIMEOUT_MS });

  // 5. Both viewers are told, without reloading.
  for (const viewer of viewers) {
    await expect(viewer.getByText("This broadcast has ended")).toBeVisible({ timeout: PUSH_TIMEOUT_MS });
  }

  // 6. The rows agree.
  const [row] = await sql<{ status: string; peak: number; viewers: number; mode: string | null }[]>`
    select b.status, b.peak_viewers as peak,
           (select count(distinct v.user_id)::int from broadcast_viewers v where v.broadcast_id = b.id) as viewers,
           (select live_mode::text from tutor_profiles where user_id = b.tutor_id) as mode
      from broadcasts b where b.id = ${broadcastId}
  `;
  expect(row).toEqual({ status: "ended", peak: 2, viewers: 2, mode: null });
});
