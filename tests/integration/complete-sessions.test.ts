import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createFixtureBooking,
  deleteFixtureBooking,
  openConnection,
  readClassification,
  readEarnings,
  type FixtureBooking,
  type FixtureBookingOptions,
  type TestConnection,
} from "./helpers/test-db";
import { splitEarnings } from "@/lib/credits/fees";

/**
 * The `complete-sessions` sweep against a real Postgres (SPEC §12, §7.11, §7.4).
 *
 * **Why this cannot be a unit test.** Every rule under test is expressed in SQL:
 * the two elapsed predicates, the `CASE` that classifies a no-show, the
 * `ended_at` cap inside the shipped `UPDATE`, and — most of all — the
 * `ON CONFLICT DO NOTHING` on `tutor_earnings.booking_id`, which is a database
 * constraint doing the work. A fake store would agree with whatever the
 * TypeScript around it believed.
 *
 * **This file does NOT mock `@/db`, and that is deliberate.** The other two
 * files in this lane mock it so their statements can be bound to two specific
 * held transactions and made to contend for a row lock. There is no contest
 * here — and binding the sweep to a single held transaction would actively
 * misrepresent it: the shipped run is a **sequence of autocommitted
 * statements**, and its idempotence claim is about a second *run*, not a second
 * statement inside one transaction. So the sweep runs against the real `@/db`
 * singleton, which `--env-file=.env.test` points at the disposable test project
 * (asserted twice before a test is collected: `vitest.integration.config.ts`
 * checks the file, `helpers/test-db.ts` checks the string it connects with).
 *
 * The reads that verify a write go through a separate connection of this file's
 * own, so nothing is confirmed by the same path that produced it.
 *
 * **Assertions are `toContain`, not array equality.** The sweep is global by
 * nature — it has no notion of "this test's rows" — so an equality assertion
 * would be a claim about the whole test project's data rather than about the
 * behaviour under test, and would fail for the wrong reason the first time a
 * leftover row existed.
 */

const { runCompleteSessionsSweep } = await import(
  "@/lib/sessions/complete-sessions"
);
const { getEarningsSettings } = await import("@/lib/settings");

describe("complete-sessions sweep (test project)", () => {
  let conn: TestConnection;
  const created: string[] = [];
  let feePercent = 25;
  let holdHours = 48;

  beforeAll(async () => {
    conn = openConnection("sweep");
    // Read through the SHIPPED accessor, not a constant: this is
    // `getEarningsSettings`'s first caller anywhere, and every expected number
    // below is derived from what it returns. If it coerced or defaulted wrongly,
    // the split and hold assertions move with it rather than silently agreeing
    // with a hardcoded 25 / 48.
    const settings = await getEarningsSettings();
    feePercent = settings.platformFeePercent;
    holdHours = settings.earningsHoldHours;
  });

  afterAll(async () => {
    for (const id of created) {
      await deleteFixtureBooking(conn, id).catch(() => undefined);
    }
    await conn.end();
    // The sweep ran against the `@/db` singleton, whose pool would otherwise
    // keep the process alive after the last assertion.
    const { db } = await import("@/db");
    await (db.$client as { end: (o?: unknown) => Promise<void> }).end({
      timeout: 5,
    });
  });

  afterEach(async () => {
    // Fixtures are deleted after every test, not at the end: the sweep is global,
    // so a row left `in_progress` past its clock would be picked up by the next
    // test's run and counted in its results.
    for (const id of created.splice(0)) {
      await deleteFixtureBooking(conn, id).catch(() => undefined);
    }
  });

  async function seed(options: FixtureBookingOptions): Promise<FixtureBooking> {
    const fixture = await createFixtureBooking(conn, options);
    created.push(fixture.bookingId);
    return fixture;
  }

  // -------------------------------------------------------------------------
  // Predicate 1 — instant, started, elapsed
  // -------------------------------------------------------------------------

  it("completes an elapsed instant session and caps ended_at at the deadline", async () => {
    // Fifty minutes ago, thirty-minute session: the deadline passed twenty
    // minutes ago and nobody was there to close it — the both-parties-offline
    // case Part 3B deliberately left to this cron.
    // 50 credits at 25% is 12.5 — a gross whose fee lands EXACTLY on the half.
    // That is the whole point of the number: floor gives the platform 12 and the
    // tutor 38, half-up gives 13/37, and any gross that does not straddle a half
    // makes the two rounding rules indistinguishable. The falsification pass
    // found this the hard way — with 41 (10.25) here, inlining a round-half-up
    // split in place of `splitEarnings` failed nothing at all.
    const { bookingId, tutorId } = await seed({
      startedMinutesAgo: 50,
      durationMinutes: 30,
      priceCredits: 50,
    });

    const result = await runCompleteSessionsSweep();
    expect(result.completedIds).toContain(bookingId);

    const row = await readClassification(conn, bookingId);
    expect(row.status).toBe("completed");
    expect(row.billedMinutes).toBe(30);

    // THE property Part 3C inherits: `started_at + 30m`, not `now()`. The sweep
    // is running twenty minutes late and must write what the deadline actor
    // would have written, because `available_at` is derived from it.
    const expectedEnd = row.startedAt!.getTime() + 30 * 60_000;
    expect(Math.abs(row.endedAt!.getTime() - expectedEnd)).toBeLessThan(1000);
    expect(row.endedAt!.getTime()).toBeLessThan(Date.now() - 15 * 60_000);

    const earning = await readEarnings(conn, bookingId);
    expect(earning).not.toBeNull();
    expect(earning!.tutorId).toBe(tutorId);
    expect(earning!.status).toBe("held");
    // The split comes from the shipped helper, not from arithmetic restated
    // here — but the expected numbers are pinned too, so a helper that started
    // rounding the other way would not simply move the expectation with it.
    const split = splitEarnings(50, feePercent);
    expect(split.platformFeeCredits).toBe(12); // NOT 13: the half goes to the tutor
    expect(split.netCredits).toBe(38);
    expect(earning!.grossCredits).toBe(split.grossCredits);
    expect(earning!.platformFeeCredits).toBe(split.platformFeeCredits);
    expect(earning!.netCredits).toBe(split.netCredits);
    expect(split.platformFeeCredits + split.netCredits).toBe(50);

    // available_at = ended_at + earnings_hold_hours, off the CAPPED ended_at —
    // so a sweep running late does not move the tutor's withdrawal date.
    const expectedAvailable =
      row.endedAt!.getTime() + holdHours * 60 * 60 * 1000;
    expect(Math.abs(earning!.availableAt!.getTime() - expectedAvailable)).toBeLessThan(
      1000,
    );
  });

  it("leaves an instant session that has not elapsed alone", async () => {
    const { bookingId } = await seed({
      startedMinutesAgo: 29,
      durationMinutes: 30,
    });

    const result = await runCompleteSessionsSweep();
    expect(result.completedIds).not.toContain(bookingId);

    const row = await readClassification(conn, bookingId);
    expect(row.status).toBe("in_progress");
    expect(row.endedAt).toBeNull();
    expect(await readEarnings(conn, bookingId)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Predicate 2 — instant, never started (the no-show work set)
  // -------------------------------------------------------------------------

  it("classifies a never-started instant booking with no tutor as no_show_tutor, and pays nothing", async () => {
    const { bookingId } = await seed({
      // Created forty minutes ago for a thirty-minute session: the booked
      // window is gone and `started_at` is still null.
      createdMinutesAgo: 40,
      durationMinutes: 30,
      studentJoinedMinutesAgo: 38,
      tutorJoinedMinutesAgo: null,
    });

    const result = await runCompleteSessionsSweep();
    expect(result.noShowTutorIds).toContain(bookingId);
    expect(result.earningsCreatedIds).not.toContain(bookingId);

    const row = await readClassification(conn, bookingId);
    expect(row.status).toBe("no_show_tutor");
    expect(row.endedAt).not.toBeNull();

    // The money rule this phase decided: a tutor who was not in the room is not
    // paid, even though §7.4 forbids refunding the student.
    expect(await readEarnings(conn, bookingId)).toBeNull();
  });

  it("classifies a never-started instant booking with no student as no_show_student, and pays in full", async () => {
    const { bookingId, tutorId } = await seed({
      createdMinutesAgo: 40,
      durationMinutes: 30,
      studentJoinedMinutesAgo: null,
      tutorJoinedMinutesAgo: 38,
      // 30 @ 25% is 7.5 — again straddling the half, so this asserts the
      // rounding rule and not just that some split happened.
      priceCredits: 30,
    });

    const before = Date.now();
    const result = await runCompleteSessionsSweep();
    expect(result.noShowStudentIds).toContain(bookingId);
    expect(result.earningsCreatedIds).toContain(bookingId);

    const row = await readClassification(conn, bookingId);
    expect(row.status).toBe("no_show_student");
    // The one timestamp that legitimately records observation: there is no
    // session end to record, because there was no session.
    expect(row.endedAt!.getTime()).toBeGreaterThanOrEqual(before - 5000);
    expect(row.endedAt!.getTime()).toBeLessThanOrEqual(Date.now() + 5000);

    const earning = await readEarnings(conn, bookingId);
    expect(earning).not.toBeNull();
    expect(earning!.tutorId).toBe(tutorId);
    expect(earning!.status).toBe("held");
    // Identical treatment to `completed`: the tutor held the slot and was there.
    const split = splitEarnings(30, feePercent);
    expect(earning!.grossCredits).toBe(30);
    expect(earning!.platformFeeCredits).toBe(split.platformFeeCredits);
    expect(earning!.netCredits).toBe(split.netCredits);
    expect(earning!.platformFeeCredits).toBe(7); // NOT 8
    expect(earning!.netCredits).toBe(23);

    const expectedAvailable =
      row.endedAt!.getTime() + holdHours * 60 * 60 * 1000;
    expect(Math.abs(earning!.availableAt!.getTime() - expectedAvailable)).toBeLessThan(
      1000,
    );
  });

  it("classifies a never-started instant booking with NEITHER party as no_show_tutor", async () => {
    const { bookingId } = await seed({
      createdMinutesAgo: 40,
      durationMinutes: 30,
      studentJoinedMinutesAgo: null,
      tutorJoinedMinutesAgo: null,
    });

    const result = await runCompleteSessionsSweep();
    // Tutor-absence takes precedence. An empty room is not evidence that the
    // tutor was there, so the classification that pays nobody wins.
    expect(result.noShowTutorIds).toContain(bookingId);
    expect(result.noShowStudentIds).not.toContain(bookingId);
    expect((await readClassification(conn, bookingId)).status).toBe(
      "no_show_tutor",
    );
    expect(await readEarnings(conn, bookingId)).toBeNull();
  });

  it("leaves a never-started instant booking whose window has not passed alone", async () => {
    const { bookingId } = await seed({
      // Five minutes into a thirty-minute booked window — the tutor accepted and
      // the pair may still be connecting.
      createdMinutesAgo: 5,
      durationMinutes: 30,
      studentJoinedMinutesAgo: null,
      tutorJoinedMinutesAgo: null,
    });

    const result = await runCompleteSessionsSweep();
    expect(result.noShowTutorIds).not.toContain(bookingId);
    expect((await readClassification(conn, bookingId)).status).toBe(
      "in_progress",
    );
  });

  // -------------------------------------------------------------------------
  // Predicate 3 — scheduled
  // -------------------------------------------------------------------------

  it("completes a scheduled booking past its end plus the 30-minute grace", async () => {
    const { bookingId } = await seed({
      type: "scheduled",
      status: "confirmed",
      durationMinutes: 60,
      // Ended 45 minutes ago: past the grace.
      scheduledEndMinutesAgo: 45,
      startedMinutesAgo: 100,
      priceCredits: 50, // 12.5 again — the scheduled path splits by the same rule
    });

    const result = await runCompleteSessionsSweep();
    expect(result.completedIds).toContain(bookingId);

    const row = await readClassification(conn, bookingId);
    expect(row.status).toBe("completed");
    // `ended_at = scheduled_end_at`, not `now()`: the session ended when it was
    // booked to end and the sweep merely noticed.
    expect(row.endedAt!.getTime()).toBe(row.scheduledEndAt!.getTime());
    expect(row.billedMinutes).toBe(60);

    const earning = await readEarnings(conn, bookingId);
    const split = splitEarnings(50, feePercent);
    expect(earning!.netCredits).toBe(split.netCredits);
    expect(earning!.platformFeeCredits).toBe(split.platformFeeCredits);
    expect(earning!.platformFeeCredits).toBe(12); // NOT 13
    const expectedAvailable =
      row.scheduledEndAt!.getTime() + holdHours * 60 * 60 * 1000;
    expect(Math.abs(earning!.availableAt!.getTime() - expectedAvailable)).toBeLessThan(
      1000,
    );
  });

  it("leaves a scheduled booking inside the 30-minute grace alone", async () => {
    const { bookingId } = await seed({
      type: "scheduled",
      status: "confirmed",
      durationMinutes: 60,
      // Ended 20 minutes ago — inside the grace. A session that ran over is
      // still in the room.
      scheduledEndMinutesAgo: 20,
      startedMinutesAgo: 80,
    });

    const result = await runCompleteSessionsSweep();
    expect(result.completedIds).not.toContain(bookingId);

    const row = await readClassification(conn, bookingId);
    expect(row.status).toBe("confirmed");
    expect(row.endedAt).toBeNull();
    expect(await readEarnings(conn, bookingId)).toBeNull();
  });

  it("classifies a scheduled booking nobody attended as no_show_tutor, and pays nothing", async () => {
    const { bookingId } = await seed({
      type: "scheduled",
      status: "confirmed",
      durationMinutes: 60,
      scheduledEndMinutesAgo: 200,
      // No `startedMinutesAgo`: the pair never met.
      studentJoinedMinutesAgo: 250,
      tutorJoinedMinutesAgo: null,
    });

    const result = await runCompleteSessionsSweep();
    expect(result.noShowTutorIds).toContain(bookingId);

    const row = await readClassification(conn, bookingId);
    expect(row.status).toBe("no_show_tutor");
    // Still the scheduled end, not the moment of classification — there IS an
    // occurrence to record here, unlike the instant no-show case.
    expect(row.endedAt!.getTime()).toBe(row.scheduledEndAt!.getTime());
    expect(await readEarnings(conn, bookingId)).toBeNull();
  });

  it("sweeps an in_progress scheduled booking as well as a confirmed one", async () => {
    const { bookingId } = await seed({
      type: "scheduled",
      status: "in_progress",
      durationMinutes: 60,
      scheduledEndMinutesAgo: 400,
      startedMinutesAgo: 460,
    });

    const result = await runCompleteSessionsSweep();
    expect(result.completedIds).toContain(bookingId);
    expect((await readClassification(conn, bookingId)).status).toBe("completed");
  });

  // -------------------------------------------------------------------------
  // Idempotence
  // -------------------------------------------------------------------------

  it("a second immediate run returns zero counts and changes nothing", async () => {
    const elapsed = await seed({
      startedMinutesAgo: 50,
      durationMinutes: 30,
      priceCredits: 41,
    });
    const noShow = await seed({
      createdMinutesAgo: 40,
      durationMinutes: 30,
      studentJoinedMinutesAgo: null,
      tutorJoinedMinutesAgo: 38,
      priceCredits: 60,
    });

    const first = await runCompleteSessionsSweep();
    expect(first.completedIds).toContain(elapsed.bookingId);
    expect(first.noShowStudentIds).toContain(noShow.bookingId);
    expect(first.earningsCreatedIds).toEqual(
      expect.arrayContaining([elapsed.bookingId, noShow.bookingId]),
    );

    const afterFirst = await Promise.all([
      readClassification(conn, elapsed.bookingId),
      readClassification(conn, noShow.bookingId),
      readEarnings(conn, elapsed.bookingId),
      readEarnings(conn, noShow.bookingId),
    ]);

    const second = await runCompleteSessionsSweep();

    // Not just "these ids are absent" — the whole second run found nothing at
    // all, because every predicate stops matching the rows it just moved.
    expect(second.completedIds).not.toContain(elapsed.bookingId);
    expect(second.noShowStudentIds).not.toContain(noShow.bookingId);
    expect(second.earningsCreatedIds).toEqual([]);

    const afterSecond = await Promise.all([
      readClassification(conn, elapsed.bookingId),
      readClassification(conn, noShow.bookingId),
      readEarnings(conn, elapsed.bookingId),
      readEarnings(conn, noShow.bookingId),
    ]);
    // Byte-for-byte: an `ended_at` or `available_at` that moved on a retry would
    // move a tutor's withdrawal date every time the job ran twice.
    expect(JSON.stringify(afterSecond)).toBe(JSON.stringify(afterFirst));

    for (const id of [elapsed.bookingId, noShow.bookingId]) {
      const rows = await conn.db.execute<{ n: string }>(
        sql`select count(*) as n from tutor_earnings where booking_id = ${id}`,
      );
      expect(Number(rows[0].n)).toBe(1);
    }
  });

  it("cannot double-pay a booking that already has an earnings row", async () => {
    // The window the status predicates cannot close: a transition committed, its
    // earnings insert did not, and the run is retried — or two runs overlap. The
    // UNIQUE on `tutor_earnings.booking_id` plus ON CONFLICT DO NOTHING is what
    // makes the second insert a no-op instead of a second payment or a 500.
    const { bookingId, tutorId } = await seed({
      startedMinutesAgo: 50,
      durationMinutes: 30,
      priceCredits: 41,
    });

    // A pre-existing row with values the sweep would never compute, so "the
    // sweep did not overwrite it" is unambiguous.
    const preExistingId = randomUUID();
    await conn.db.execute(sql`
      insert into tutor_earnings (
        id, tutor_id, booking_id, gross_credits, platform_fee_credits,
        net_credits, status, available_at
      ) values (
        ${preExistingId}, ${tutorId}, ${bookingId}, 999, 111, 888, 'held',
        now() + interval '999 hours'
      )
    `);

    const result = await runCompleteSessionsSweep();
    // The booking itself still transitions — the guard is on the payment, not on
    // the completion.
    expect(result.completedIds).toContain(bookingId);
    expect(result.earningsCreatedIds).not.toContain(bookingId);

    const rows = await conn.db.execute<{ n: string }>(
      sql`select count(*) as n from tutor_earnings where booking_id = ${bookingId}`,
    );
    expect(Number(rows[0].n)).toBe(1);

    const earning = await readEarnings(conn, bookingId);
    expect(earning!.grossCredits).toBe(999);
    expect(earning!.netCredits).toBe(888);
  });

  it("transitions a NULL-price booking but writes no earnings row for it", async () => {
    // `price_credits` is written by both the accept transaction and the
    // scheduled booking action, so NULL here means a row that predates that
    // guarantee. It must NOT become a zero-credit earnings row:
    // `tutor_earnings.booking_id` is UNIQUE with ON CONFLICT DO NOTHING, so a
    // wrong zero written now would permanently occupy the one earnings slot
    // this booking is allowed and block the correct row forever.
    const { bookingId } = await seed({
      startedMinutesAgo: 50,
      durationMinutes: 30,
      priceCredits: null,
    });

    const result = await runCompleteSessionsSweep();

    // The status transition is unaffected — only the earnings row is withheld.
    expect(result.completedIds).toContain(bookingId);
    expect(result.earningsCreatedIds).not.toContain(bookingId);
    expect(result.earningsSkippedNoPriceIds).toContain(bookingId);

    const row = await readClassification(conn, bookingId);
    expect(row.status).toBe("completed");
    expect(row.priceCredits).toBeNull();

    expect(await readEarnings(conn, bookingId)).toBeNull();
  });
});
