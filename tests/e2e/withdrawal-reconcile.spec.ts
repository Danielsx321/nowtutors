import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { parse } from "dotenv";
import postgres from "postgres";
import { assertTestProjectRef } from "../../src/db/load-env";

/**
 * SPEC §15 E2E path 4 — **withdrawal to reconcile**, Phase 8 acceptance.
 *
 *   a completed session's earnings release → the tutor requests a withdrawal in
 *   the browser → an admin approves and marks it paid in the browser →
 *   `reconcile-wallets` reports zero mismatches → the earnings row is `withdrawn`
 *   and the tutor's wallet is empty.
 *
 * Test project only (`uietkphpfqaicbndunwt`). The fixture is written straight to
 * the database: one completed scheduled booking and its held earnings row, due
 * an hour ago, for `tutor3`. Everything after that goes through the shipped
 * routes and pages: the release and reconcile crons over HTTP with the test
 * project's `CRON_SECRET`, and the request, approve and mark-paid clicks through
 * real sign-ins. Nothing is cleaned up, because every row it leaves is a
 * consistent, fully paid-out record; `pnpm db:seed:test` resets it.
 *
 * Preconditions it checks rather than assumes: `tutor3` has no open withdrawal
 * (a failed earlier run can leave one), and `payout_usd_per_credit` is set (the
 * test project predates PR #57's seed value, so it is upserted to 1 here).
 */

const TEST_ENV = parse(readFileSync(".env.test", "utf8"));
assertTestProjectRef(`${TEST_ENV.DATABASE_URL ?? ""} ${TEST_ENV.NEXT_PUBLIC_SUPABASE_URL ?? ""}`);

const PASSWORD = process.env.E2E_PASSWORD ?? "Password123!";
const TUTOR_EMAIL = "tutor3@nowtutors.dev";
const STUDENT_EMAIL = "student2@nowtutors.dev";
const ADMIN_EMAIL = "admin@nowtutors.dev";
const SIGNIN_TIMEOUT_MS = 15_000;
const ACTION_TIMEOUT_MS = 20_000;

const sql = postgres(TEST_ENV.DATABASE_URL!, { prepare: false, max: 1 });

test.afterAll(async () => {
  await sql.end({ timeout: 5 });
});

async function signIn(page: Page, email: string, landing: RegExp) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page).toHaveURL(landing, { timeout: SIGNIN_TIMEOUT_MS });
}

async function cron(request: import("@playwright/test").APIRequestContext, job: string) {
  const res = await request.get(`/api/cron/${job}`, {
    headers: { Authorization: `Bearer ${TEST_ENV.CRON_SECRET}` },
  });
  expect(res.status(), `${job} answered ${res.status()}`).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

test("released earnings → withdrawal requested → approved → paid → reconcile finds no drift", async ({ browser, request }) => {
  const [ids] = await sql<{ tutor: string; student: string; open: number }[]>`
    select (select id from profiles where email = ${TUTOR_EMAIL}) as tutor,
           (select id from profiles where email = ${STUDENT_EMAIL}) as student,
           (select count(*)::int from withdrawal_requests r join profiles p on p.id = r.tutor_id
             where p.email = ${TUTOR_EMAIL} and r.status in ('requested', 'approved')) as open
  `;
  expect(ids.tutor, "seeded tutor3 exists (pnpm db:seed:test)").toBeTruthy();
  expect(ids.open, "tutor3 has no open withdrawal left from an earlier run").toBe(0);
  await sql`
    insert into platform_settings (key, value, description)
    values ('payout_usd_per_credit', '1'::jsonb, 'USD paid per credit at withdrawal (Phase 8 Part 2)')
    on conflict (key) do update set value = excluded.value
  `;

  // 1. A completed session whose held earnings are due.
  const [booking] = await sql<{ id: string }[]>`
    insert into bookings (student_id, tutor_id, type, status, scheduled_start_at, scheduled_end_at,
                          ended_at, duration_minutes, price_credits, payment_method)
    values (${ids.student}, ${ids.tutor}, 'scheduled', 'completed',
            now() - interval '4 days 1 hour', now() - interval '4 days',
            now() - interval '4 days', 60, 60, 'credits')
    returning id
  `;
  await sql`
    insert into tutor_earnings (tutor_id, booking_id, gross_credits, platform_fee_credits, net_credits, status, available_at)
    values (${ids.tutor}, ${booking.id}, 60, 15, 45, 'held', now() - interval '1 hour')
  `;

  // 2. Release through the shipped cron route.
  await cron(request, "release-earnings");
  const [released] = await sql<{ status: string; balance: number }[]>`
    select e.status, coalesce(w.credit_balance, 0) as balance
      from tutor_earnings e left join wallets w on w.user_id = e.tutor_id
     where e.booking_id = ${booking.id}
  `;
  expect(released.status).toBe("available");
  expect(released.balance).toBeGreaterThanOrEqual(45);

  // 3. The tutor requests the whole balance.
  const tutorContext = await browser.newContext();
  const tutorPage = await tutorContext.newPage();
  await signIn(tutorPage, TUTOR_EMAIL, /\/tutor(\/|$)/);
  await tutorPage.goto("/tutor/withdrawals");
  await expect(tutorPage.getByRole("heading", { name: /^withdrawals$/i })).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
  // The label is "Withdraw N credits ($X)" once a payout rate is set (it is, above).
  await tutorPage.getByRole("button", { name: /^withdraw [\d,]+ credits/i }).click({ timeout: ACTION_TIMEOUT_MS });
  await expect(tutorPage.getByText(/withdrawal requested/i)).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
  await tutorContext.close();

  const [requested] = await sql<{ id: string; status: string; amount: number }[]>`
    select id, status, amount_credits as amount from withdrawal_requests
     where tutor_id = ${ids.tutor} and status = 'requested'
  `;
  expect(requested?.amount).toBe(released.balance);

  // 4. An admin approves, then marks it paid with a PayPal reference.
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signIn(adminPage, ADMIN_EMAIL, /\/admin(\/|$)/);
  await adminPage.goto("/admin/withdrawals?status=requested");
  await adminPage.getByRole("button", { name: /^approve$/i }).first().click({ timeout: ACTION_TIMEOUT_MS });
  await expect
    .poll(async () => (await sql`select status from withdrawal_requests where id = ${requested.id}`)[0]?.status, {
      timeout: ACTION_TIMEOUT_MS,
    })
    .toBe("approved");

  const reference = `E2E-${Date.now()}`;
  await adminPage.goto("/admin/withdrawals?status=approved");
  await adminPage.getByRole("button", { name: /^mark paid$/i }).first().click({ timeout: ACTION_TIMEOUT_MS });
  await adminPage.getByLabel(/paypal transaction id/i).fill(reference, { timeout: ACTION_TIMEOUT_MS });
  await adminPage.getByRole("button", { name: /^confirm paid$/i }).click({ timeout: ACTION_TIMEOUT_MS });
  await expect
    .poll(async () => (await sql`select status from withdrawal_requests where id = ${requested.id}`)[0]?.status, {
      timeout: ACTION_TIMEOUT_MS,
    })
    .toBe("paid");
  await adminContext.close();

  // 5. Reconcile over HTTP, then the rows themselves.
  const summary = await cron(request, "reconcile-wallets");
  expect(summary).toMatchObject({ ok: true, drift: false, mismatches: 0 });

  const [after] = await sql<{ earning: string; balance: number; reference: string }[]>`
    select (select status from tutor_earnings where booking_id = ${booking.id}) as earning,
           coalesce((select credit_balance from wallets where user_id = ${ids.tutor}), 0) as balance,
           (select external_reference from withdrawal_requests where id = ${requested.id}) as reference
  `;
  expect(after).toEqual({ earning: "withdrawn", balance: 0, reference });
});
