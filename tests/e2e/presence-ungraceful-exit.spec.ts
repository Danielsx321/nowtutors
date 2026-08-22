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
 * Nor does anything signal the exit: the `pagehide` `sendBeacon` that an earlier
 * revision used to clear `is_live` was removed before merge (docs/DECISIONS.md),
 * so this test now rests on the `live_tutors` view **alone** — which is the
 * strongest form of the assertion, not a weakened one.
 *
 * The second half of §15's path 3 — "and the request expires" — needs
 * `session_requests` to have a writer, which lands in Phase 6 Part 2. It is
 * stubbed as `test.fixme` below rather than quietly dropped.
 */

const TUTOR_EMAIL = process.env.E2E_TUTOR_EMAIL ?? "tutor1@nowtutors.dev";
const TUTOR_PASSWORD = process.env.E2E_PASSWORD ?? "Password123!";
/**
 * Seed slug for TUTOR_EMAIL (src/db/seed.ts). Membership is asserted against the
 * profile LINK, not a display name: the seeded `display_name` is "Tom" while
 * `full_name` is "Tom Turner", and matching the wrong one silently makes every
 * assertion false rather than failing loudly.
 */
const TUTOR_SLUG = process.env.E2E_TUTOR_SLUG ?? "tom-turner";

/** The live_tutors threshold (2 min) plus room for the poll interval. */
const STALENESS_BUDGET_MS = 150_000;

const SIGNIN_TIMEOUT_MS = 60_000;

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(TUTOR_EMAIL);
  await page.getByLabel(/password/i).fill(TUTOR_PASSWORD);
  await page.getByRole("button", { name: /^log in$/i }).click();

  // Race the redirect against the form's error alert. Waiting on the URL alone
  // means a rejected sign-in burns the ENTIRE test timeout and then reports
  // "waiting for navigation", which says nothing about why — the failure looks
  // like a presence bug when it is an environment problem.
  const landed = page
    .waitForURL(/\/tutor(\/|$)/, { timeout: SIGNIN_TIMEOUT_MS })
    .then(() => "landed" as const);
  const rejected = page
    .getByRole("alert")
    .filter({ hasText: /invalid email or password/i })
    .first()
    .waitFor({ state: "visible", timeout: SIGNIN_TIMEOUT_MS })
    .then(() => "rejected" as const);
  // Both are awaited by the race; attach no-op catches so whichever loses cannot
  // surface later as an unhandled rejection.
  landed.catch(() => {});
  rejected.catch(() => {});

  if ((await Promise.race([landed, rejected])) === "rejected") {
    throw new Error(
      'Sign-in rejected: "Invalid email or password". Note the login action ' +
        "returns that same message for BAD CREDENTIALS and for an UNREACHABLE " +
        "Supabase Auth — deliberately, so the form cannot be used to enumerate " +
        "accounts (src/actions/auth.ts). So check both: re-run `pnpm db:seed` " +
        "for the fixture, and confirm the app can reach Supabase.",
    );
  }
}

/**
 * Is the tutor currently listed on the Live-now browse filter?
 *
 * `/tutors` 307s to `/` (the browse page) preserving the query string, so this
 * lands on `/?live=1` either way. Cache-busted, so a stale RSC/router cache
 * cannot answer on the database's behalf.
 */
async function isListedLive(page: Page): Promise<boolean> {
  await page.goto(`/tutors?live=1&_t=${Date.now()}`);
  return (await page.locator(`a[href^="/tutors/${TUTOR_SLUG}"]`).count()) > 0;
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

      // 3. The browser dies. Nothing in the app signals departure — there is no
      //    `pagehide` beacon (it was removed; see docs/DECISIONS.md), so a plain
      //    close and a killed process are indistinguishable to the server. The
      //    context is taken offline first anyway, so that not even an in-flight
      //    heartbeat can land after this line and refresh `last_seen_at` — that
      //    would restart the staleness window and make the test flaky rather
      //    than wrong. `is_live` stays `true` in tutor_profiles from here on.
      await tutorContext.setOffline(true);
      await tutorContext.close();

      // 4. Within the staleness window, and with NOTHING having swept the row
      //    and NOTHING having signalled the exit, the tutor is gone from the
      //    students' view. `is_live` is still `true` in tutor_profiles — the
      //    disappearance is the `live_tutors` view's `last_seen_at` filter doing
      //    the whole job on its own, which is precisely §3.1's claim.
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
