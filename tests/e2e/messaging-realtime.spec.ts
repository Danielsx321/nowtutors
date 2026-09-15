import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { parse } from "dotenv";
import postgres from "postgres";
import { assertTestProjectRef } from "../../src/db/load-env";

/**
 * SPEC §15 E2E path 6: **two browsers exchange messages in real time**, the
 * first half of Phase 9 acceptance (§16).
 *
 *   student2 opens tutor3's profile → Message → sends a line → tutor3's topbar
 *   badge shows 1 WITHOUT a reload → tutor3 opens the thread and replies →
 *   student2 sees the reply WITHOUT a reload → student2's badge is gone, because
 *   the open thread marked it read.
 *
 * Test project only (`uietkphpfqaicbndunwt`). Before the run, every unread message
 * to either account is marked read, so the badge starts from nothing (the seed
 * leaves one unread in their thread on purpose). The two messages this test sends
 * are deleted afterwards.
 *
 * "Without a reload" is the property under test: neither page is reloaded or
 * navigated between the send and the assertion that sees it.
 */

const TEST_ENV = parse(readFileSync(".env.test", "utf8"));
assertTestProjectRef(`${TEST_ENV.DATABASE_URL ?? ""} ${TEST_ENV.NEXT_PUBLIC_SUPABASE_URL ?? ""}`);

const PASSWORD = process.env.E2E_PASSWORD ?? "Password123!";
const STUDENT_EMAIL = "student2@nowtutors.dev";
const TUTOR_EMAIL = "tutor3@nowtutors.dev";
const TUTOR_SLUG = "theo-chen";
const SIGNIN_TIMEOUT_MS = 15_000;
const ACTION_TIMEOUT_MS = 20_000;
/**
 * Realtime delivery. Normally under a second, but the free-tier Realtime tenant
 * sleeps when idle and the retrying channel may need a backoff round to connect
 * (SPEC §8), so this carries a cold start.
 */
const REALTIME_TIMEOUT_MS = 45_000;

const sql = postgres(TEST_ENV.DATABASE_URL!, { prepare: false, max: 1 });
const sentBodies: string[] = [];

test.afterAll(async () => {
  if (sentBodies.length) await sql`delete from messages where body in ${sql(sentBodies)}`;
  await sql.end({ timeout: 5 });
});

async function signedInPage(browser: Browser, email: string, landing: RegExp): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page).toHaveURL(landing, { timeout: SIGNIN_TIMEOUT_MS });
  return page;
}

async function send(page: Page, body: string) {
  await page.getByRole("textbox", { name: "Message" }).fill(body, { timeout: ACTION_TIMEOUT_MS });
  await page.getByRole("button", { name: "Send message" }).click({ timeout: ACTION_TIMEOUT_MS });
  sentBodies.push(body);
}

test("E2E 6: a student and a tutor exchange messages without reloading", async ({ browser }) => {
  const [ids] = await sql<{ student: string; tutor: string }[]>`
    select (select id from profiles where email = ${STUDENT_EMAIL}) as student,
           (select id from profiles where email = ${TUTOR_EMAIL}) as tutor
  `;
  expect(ids.student && ids.tutor, "seeded student2 and tutor3 exist (pnpm db:seed:test)").toBeTruthy();
  await sql`
    update messages m set read_at = now()
      from conversations c
     where m.conversation_id = c.id
       and m.read_at is null
       and (c.participant_a in (${ids.student}, ${ids.tutor}) or c.participant_b in (${ids.student}, ${ids.tutor}))
  `;

  // Both signed in, the tutor sitting on their overview with no unread badge.
  const tutorPage = await signedInPage(browser, TUTOR_EMAIL, /\/tutor(\/|$)/);
  // The topbar icon and the sidebar item are both "Messages" links; either proves the shell rendered.
  await expect(tutorPage.getByRole("link", { name: /^messages/i }).first()).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
  await expect(tutorPage.getByTestId("unread-badge")).toHaveCount(0);

  const studentPage = await signedInPage(browser, STUDENT_EMAIL, /\/dashboard(\/|$)/);

  // 1. The student starts (or reopens) the thread from the tutor's profile.
  await studentPage.goto(`/tutors/${TUTOR_SLUG}`);
  await studentPage.getByRole("button", { name: /^message$/i }).click({ timeout: ACTION_TIMEOUT_MS });
  await expect(studentPage).toHaveURL(/\/dashboard\/messages\/[0-9a-f-]{36}$/, { timeout: ACTION_TIMEOUT_MS });
  const conversationId = studentPage.url().split("/").pop()!;

  const hello = `Hello from E2E ${Date.now()}`;
  await send(studentPage, hello);
  await expect(studentPage.getByText(hello)).toBeVisible({ timeout: ACTION_TIMEOUT_MS });

  // 2. The tutor's badge counts it, on a page that was never reloaded.
  await expect(tutorPage.getByTestId("unread-badge")).toHaveText("1", { timeout: REALTIME_TIMEOUT_MS });

  // 3. The tutor opens the thread and replies.
  await tutorPage.goto(`/tutor/messages/${conversationId}`);
  await expect(tutorPage.getByText(hello)).toBeVisible({ timeout: ACTION_TIMEOUT_MS });
  const reply = `Reply from E2E ${Date.now()}`;
  await send(tutorPage, reply);
  await expect(tutorPage.getByText(reply)).toBeVisible({ timeout: ACTION_TIMEOUT_MS });

  // 4. The student sees the reply without a reload, and the open thread marks it
  //    read, so their badge goes away.
  await expect(studentPage.getByText(reply)).toBeVisible({ timeout: REALTIME_TIMEOUT_MS });
  await expect(studentPage.getByTestId("unread-badge")).toHaveCount(0, { timeout: REALTIME_TIMEOUT_MS });

  // 5. The database agrees: one row per message, both read.
  const rows = await sql<{ body: string; read: boolean }[]>`
    select body, read_at is not null as read from messages
     where conversation_id = ${conversationId} and body in (${hello}, ${reply})
  `;
  expect(rows.map((r) => r.body).sort()).toEqual([hello, reply].sort());
  expect(rows.every((r) => r.read)).toBe(true);
});
