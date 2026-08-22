import { expect, test, type Page } from "@playwright/test";

/**
 * SPEC §15 E2E path 3 — **the regression test for the original bug.**
 *
 * Bubble's `Is-Live` was a stored flag that an ungraceful exit never cleared, so
 * students kept seeing tutors who had closed their laptop hours earlier. SPEC
 * §3.1 fixes that by deriving live status from the `live_tutors` view, and this
 * test is the thing that proves the fix holds:
 *
 *   tutor goes live → tutor's browser dies WITHOUT a clean exit → the tutor
 *   disappears from the Live-now list within the staleness window, **with the
 *   sweep cron never running**.
 *
 * The "without the sweep" part is the whole point. If this test only passed
 * because a cron tidied the row, correctness would depend on that cron — exactly
 * the coupling §3.1 refuses. Nothing here calls `/api/cron/sweep-presence`.
 *
 * The second half of §15's path 3 — "and the request expires" — needs
 * `session_requests` to have a writer, which lands in Phase 6 Part 2. It is
 * stubbed as `test.fixme` below rather than quietly dropped.
 */

const TUTOR_EMAIL = process.env.E2E_TUTOR_EMAIL ?? "tutor1@nowtutors.dev";
const TUTOR_PASSWORD = process.env.E2E_PASSWORD ?? "Password123!";
/** Seed slug for TUTOR_EMAIL (src/db/seed.ts). */
const TUTOR_NAME = process.env.E2E_TUTOR_NAME ?? "Tom Turner";

/** The live_tutors threshold (2 min) plus room for the poll interval. */
const STALENESS_BUDGET_MS = 150_000;

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(TUTOR_EMAIL);
  await page.getByLabel(/password/i).fill(TUTOR_PASSWORD);
  await page.getByRole("button", { name: /log ?in|sign ?in/i }).click();
  await page.waitForURL(/\/tutor(\/|$)/);
}

/** Is the tutor currently listed on the Live-now browse filter? */
async function isListedLive(page: Page): Promise<boolean> {
  // Cache-busted so a stale RSC/router cache can't answer for the database.
  await page.goto(`/tutors?live=1&_t=${Date.now()}`);
  return page.getByText(TUTOR_NAME, { exact: false }).first().isVisible().catch(() => false);
}

test.describe("presence: ungraceful exit drops the tutor from Live now", () => {
  test("tutor disappears from /tutors?live=1 within the staleness window, with no sweep", async ({
    browser,
  }) => {
    const tutorContext = await browser.newContext();
    const tutorPage = await tutorContext.newPage();

    // An anonymous viewer — a separate context, so it holds no tutor session and
    // reads the list exactly as a student would.
    const viewerContext = await browser.newContext();
    const viewerPage = await viewerContext.newPage();

    try {
      // 1. Tutor goes live.
      await signIn(tutorPage);
      const toggle = tutorPage.getByRole("switch", {
        name: /available for instant sessions/i,
      });
      if ((await toggle.getAttribute("aria-checked")) !== "true") {
        await toggle.click();
      }
      await expect(toggle).toHaveAttribute("aria-checked", "true");

      // 2. They show up on the Live-now list.
      await expect
        .poll(() => isListedLive(viewerPage), { timeout: 30_000, intervals: [2_000] })
        .toBe(true);

      // 3. The browser dies ungracefully. Going offline first is what makes this
      //    UNGRACEFUL: neither the pagehide `sendBeacon` nor its keepalive-fetch
      //    fallback can reach the server, so no clean-exit signal is ever
      //    delivered — the same observable state as a killed process, a closed
      //    laptop, or a dropped connection. Closing the context with the network
      //    still up would test the beacon, not the regression.
      await tutorContext.setOffline(true);
      await tutorContext.close();

      // 4. Within the staleness window, and with NOTHING having swept the row,
      //    the tutor is gone from the students' view. `is_live` is still `true`
      //    in tutor_profiles at this point — that is precisely what §3.1 says
      //    must not matter.
      await expect
        .poll(() => isListedLive(viewerPage), {
          timeout: STALENESS_BUDGET_MS,
          intervals: [5_000],
        })
        .toBe(false);
    } finally {
      await viewerContext.close();
      // tutorContext is already closed on the happy path; closing twice is safe.
      await tutorContext.close().catch(() => {});
    }
  });

  test.fixme(
    "the tutor's pending session request expires alongside them",
    async () => {
      // SPEC §15 path 3, second half. Deferred to **Phase 6 Part 2**: nothing
      // writes `session_requests` yet (the student request flow, the Realtime
      // subscription and the accept transaction are all Part 2), so there is no
      // pending request to expire and no assertion to make that would not be
      // asserting against a hand-inserted fixture.
      //
      // When Part 2 lands, the shape is: student sends a request to the live
      // tutor → tutor's context dies offline as above → assert the request row
      // reaches `expired` past `expires_at` (60s, `instant_request_ttl_seconds`)
      // and that the student's UI stops waiting on it.
    },
  );
});
