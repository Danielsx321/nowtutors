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
 * The second half of §15's path 3 — "and the request expires" — is the second
 * test below, un-stubbed in Phase 6 Part 2 now that `session_requests` has a
 * writer. It holds the same line: **nothing sweeps**. Neither
 * `/api/cron/expire-requests` nor `/api/cron/sweep-presence` is called, so the
 * request's death is the request path's own doing — the deadline is enforced
 * where it is read, not by a job. A test that needed the cron would be asserting
 * the cron, and §7.4 says correctness must not depend on it.
 */

const TUTOR_EMAIL = process.env.E2E_TUTOR_EMAIL ?? "tutor1@nowtutors.dev";
const STUDENT_EMAIL = process.env.E2E_STUDENT_EMAIL ?? "student1@nowtutors.dev";
const TUTOR_PASSWORD = process.env.E2E_PASSWORD ?? "Password123!";
/**
 * Seed slug for TUTOR_EMAIL (src/db/seed.ts). Membership is asserted against the
 * profile LINK, not a display name: the seeded `display_name` is "Tom" while
 * `full_name` is "Tom Turner", and matching the wrong one silently makes every
 * assertion false rather than failing loudly.
 */
const TUTOR_SLUG = process.env.E2E_TUTOR_SLUG ?? "tom-turner";
/** The seeded `display_name` for TUTOR_EMAIL — what the request UI addresses. */
const TUTOR_DISPLAY_NAME = process.env.E2E_TUTOR_DISPLAY_NAME ?? "Tom";

/** The live_tutors threshold (2 min) plus room for the poll interval. */
const STALENESS_BUDGET_MS = 150_000;

const SIGNIN_TIMEOUT_MS = 60_000;

async function signIn(
  page: Page,
  email: string = TUTOR_EMAIL,
  landing: RegExp = /\/tutor(\/|$)/,
) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(TUTOR_PASSWORD);
  await page.getByRole("button", { name: /^log in$/i }).click();

  // Race the redirect against the form's error alert. Waiting on the URL alone
  // means a rejected sign-in burns the ENTIRE test timeout and then reports
  // "waiting for navigation", which says nothing about why — the failure looks
  // like a presence bug when it is an environment problem.
  // `toHaveURL` POLLS the URL; `waitForURL` waits for a navigation EVENT. The
  // login Server Action redirects via the Next router, which updates history
  // client-side without a navigation Playwright reports — so `waitForURL` sat
  // through a sign-in that had already landed on /tutor (303, RSC fetch, shell
  // mounted, heartbeats firing) and failed it at 60s. Polling observes the URL
  // that is actually there. Same regex, same timeout, same meaning.
  const landed = expect(page)
    .toHaveURL(landing, { timeout: SIGNIN_TIMEOUT_MS })
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
 * Put the tutor live — and make them ACTUALLY live, not merely flagged live.
 *
 * `is_live` is a stored flag; membership of `live_tutors` additionally requires a
 * fresh `last_seen_at` (SPEC §3.1). A tutor whose browser died ungracefully — the
 * exact state this suite is about, and the state a previous run of this suite
 * leaves behind — keeps `is_live = true` with a stale `last_seen_at`. GoLiveToggle
 * renders from that stored flag, so the switch shows CHECKED while `live_tutors`
 * correctly excludes them.
 *
 * Skipping the click on an already-checked switch therefore leaves the tutor never
 * actually live, and only the 30s heartbeat could rescue it — a race against this
 * test's own 30s budget. Reading the switch as proof of liveness would be the very
 * conflation of stored flag with derived status that §3.1 exists to forbid.
 *
 * So force a real off→on transition: only `setTutorLive(true)` writes
 * `last_seen_at = now()` (src/db/queries/presence.ts), and that write is what
 * membership actually depends on.
 */
async function goLive(page: Page): Promise<void> {
  const toggle = page.getByRole("switch", {
    name: /available for instant sessions/i,
  });
  if ((await toggle.getAttribute("aria-checked")) === "true") {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  }
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
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
      await goLive(tutorPage);

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

  test("the tutor's pending session request expires alongside them", async ({
    browser,
  }) => {
    // SPEC §15 path 3, second half — the instant handshake's other end.
    //
    // The two assertions that matter are both about MONEY not moving and the
    // student not being stranded: an unanswered request charges nothing, and it
    // does not go on holding the student's one-pending-request slot forever
    // (§7.4). Neither cron runs, so both are properties of the request path.
    const tutorContext = await browser.newContext();
    const tutorPage = await tutorContext.newPage();
    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    let revivedContext: Awaited<ReturnType<typeof browser.newContext>> | null =
      null;

    try {
      // 1. Tutor goes live.
      await signIn(tutorPage);
      await goLive(tutorPage);

      // 2. Student signs in and notes what they have. Credits are the thing an
      //    expired request must not touch, so the number is read BEFORE rather
      //    than assumed from the seed.
      await signIn(studentPage, STUDENT_EMAIL, /\/dashboard(\/|$)/);
      const balanceBefore = await readWalletBalance(studentPage);

      // 3. Student sends an instant request. "Start now" only renders for a
      //    tutor the live_tutors view returns, so waiting for it also confirms
      //    step 1 landed.
      await sendInstantRequest(studentPage);
      const waiting = studentPage.getByRole("dialog");
      await expect(
        waiting.getByText(new RegExp(`waiting for ${TUTOR_DISPLAY_NAME}`, "i")),
      ).toBeVisible();

      // 4. The tutor's browser dies mid-request. Offline first, so no in-flight
      //    heartbeat can land afterwards and restart the staleness window.
      //    Nothing signals the exit — there is no pagehide beacon.
      await tutorContext.setOffline(true);
      await tutorContext.close();

      // 5. The student stops waiting, and is told plainly that nothing was
      //    charged. The 60s ring is cosmetic, but it can only ever run out
      //    unanswered: the server refuses an accept past expires_at, so a late
      //    acceptance cannot contradict what the student was just shown.
      await expect(waiting.getByText(/no answer/i)).toBeVisible({
        timeout: 90_000,
      });
      await expect(waiting.getByText(/nothing was charged/i)).toBeVisible();
      // Two controls in this dialog answer to the accessible name "Close": the
      // outcome's own button and ModalContent's icon-only X. Only the former
      // has text, which is what distinguishes them — and it is the one the
      // student is actually being offered here.
      await waiting
        .getByRole("button", { name: /^close$/i })
        .filter({ hasText: /close/i })
        .click();

      // 6. Nothing was charged, as a fact about the wallet rather than a
      //    sentence in a modal. This is the assertion that would have caught a
      //    debit-at-request-time regression.
      expect(await readWalletBalance(studentPage)).toBe(balanceBefore);

      // 7. The student is not stuck. A student may hold at most ONE pending
      //    request (§7.4), so if the dead one were still counted as pending,
      //    this second attempt would be refused with "You already have a
      //    request waiting" — the expired row is what makes it succeed.
      //
      //    The tutor is brought back live in a fresh context first, because
      //    createSessionRequest checks liveness BEFORE the pending-request rule
      //    and an offline tutor would short-circuit past the thing under test.
      revivedContext = await browser.newContext();
      const revivedPage = await revivedContext.newPage();
      await signIn(revivedPage);
      await goLive(revivedPage);

      await sendInstantRequest(studentPage);
      await expect(
        studentPage
          .getByRole("alert")
          .filter({ hasText: /already have a request waiting/i }),
      ).toHaveCount(0);
      await expect(
        studentPage
          .getByRole("dialog")
          .getByText(new RegExp(`waiting for ${TUTOR_DISPLAY_NAME}`, "i")),
      ).toBeVisible();
    } finally {
      await studentContext.close();
      await revivedContext?.close().catch(() => {});
      await tutorContext.close().catch(() => {});
    }
  });
});

/**
 * The student's credit balance, read off `/dashboard/wallet`. The pill carries
 * `aria-label="N credits"`, so this reads the accessible name rather than
 * scraping formatted text.
 */
async function readWalletBalance(page: Page): Promise<number> {
  await page.goto(`/dashboard/wallet?_t=${Date.now()}`);
  const label = await page
    .locator('[aria-label$="credits"]')
    .first()
    .getAttribute("aria-label");
  const digits = (label ?? "").replace(/[^0-9]/g, "");
  if (digits === "") throw new Error(`No credit balance found (aria-label: ${label})`);
  return Number.parseInt(digits, 10);
}

/**
 * Open the tutor's profile and send an instant request for the shortest offered
 * duration. Cache-busted so a stale router cache cannot decide whether the
 * "Start now" card is there.
 */
async function sendInstantRequest(page: Page): Promise<void> {
  await page.goto(`/tutors/${TUTOR_SLUG}?_t=${Date.now()}`);
  await expect(page.getByRole("heading", { name: /start now/i })).toBeVisible({
    timeout: 30_000,
  });
  // The profile renders TWO "Session length" groups — the instant widget's and
  // the scheduled BookingWidget's — and both offer a "30 min" button, so a
  // page-level getByRole matches two elements and dies in strict mode. Scope to
  // the instant widget's own group by the id its <Label htmlFor> already points
  // at. "Request now" needs no scoping: only the instant widget has one.
  await page
    .locator("#instant-duration")
    .getByRole("button", { name: /^30 min/ })
    .click();
  await page.getByRole("button", { name: /^request now/i }).click();
}
