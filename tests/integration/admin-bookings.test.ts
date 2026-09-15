import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  beginTransaction,
  openConnection,
  waitUntilBlockedBy,
  withExecutor,
  type TestConnection,
} from "./helpers/test-db";

/**
 * Admin force-cancel, force-complete and PayPal refund reversal against a real
 * Postgres (SPEC §7.3, §7.6, §7.11; Phase 8 Part 6). Test project only.
 *
 * The money lives in the database: row locks, the `(type, reference_id)` index
 * that makes each refund or reversal land once, savepoints keeping the
 * transaction usable, the slot constraint freeing a cancelled booking's window,
 * and the ledger still summing to every touched wallet.
 *
 * Every fixture is built inside a transaction that is rolled back, except the
 * double-cancel race, which commits and then restores the student's balance and
 * removes its own rows in one transaction (the `resetEarningsFixture` precedent).
 */
type Executor = import("@/db").DbTransaction;

vi.mock("@/db", async () => {
  const { currentExecutor } = await import("./helpers/test-db");
  return {
    db: {
      execute: (query: SQL) => currentExecutor().execute(query),
      select: ((...args: Parameters<Executor["select"]>) =>
        currentExecutor().select(...args)) as Executor["select"],
      update: ((table: Parameters<Executor["update"]>[0]) =>
        currentExecutor().update(table)) as Executor["update"],
      insert: ((table: Parameters<Executor["insert"]>[0]) =>
        currentExecutor().insert(table)) as Executor["insert"],
      transaction: ((fn: Parameters<Executor["transaction"]>[0]) =>
        currentExecutor().transaction(fn)) as Executor["transaction"],
    },
  };
});

const q = await import("@/db/queries/admin-bookings");
const { creditWallet, debitWallet, walletExecutor } = await import("@/lib/credits/ledger");

let connA: TestConnection;
let connB: TestConnection;
let watcher: TestConnection;

beforeAll(() => {
  connA = openConnection("a");
  connB = openConnection("b");
  watcher = openConnection("watcher");
});

afterAll(async () => {
  await Promise.all([connA.end(), connB.end(), watcher.end()]);
});

async function rolledBack<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
  const held = await beginTransaction(connA);
  try {
    return await withExecutor(held.tx, () => fn(held.tx));
  } finally {
    await held.rollback();
  }
}

async function one<T>(tx: Executor, query: SQL): Promise<T> {
  const [row] = Array.from(await tx.execute<Record<string, unknown>>(query));
  return row as T;
}

async function idOf(tx: Executor, email: string): Promise<string> {
  const row = await one<{ id: string } | undefined>(tx, sql`select id from profiles where email = ${email}`);
  if (!row) throw new Error(`test project is missing seeded ${email}; run pnpm db:seed:test`);
  return row.id;
}

async function balance(tx: Executor, userId: string): Promise<number> {
  const row = await one<{ b: number } | undefined>(tx, sql`select credit_balance as b from wallets where user_id = ${userId}`);
  return row?.b ?? 0;
}

async function ledgerSumMatches(tx: Executor, userId: string): Promise<boolean> {
  const row = await one<{ ok: boolean }>(
    tx,
    sql`select coalesce((select credit_balance from wallets where user_id = ${userId}), 0)
             = coalesce((select sum(delta)::int from credit_transactions where user_id = ${userId}), 0) as ok`,
  );
  return row.ok;
}

async function rowsFor(tx: Executor, referenceId: string) {
  return Array.from(
    await tx.execute<{ type: string; user_id: string; delta: number }>(
      sql`select type, user_id, delta from credit_transactions where reference_id = ${referenceId} order by created_at, type`,
    ),
  );
}

async function audits(tx: Executor, targetId: string) {
  return Array.from(
    await tx.execute<{ action: string; actor_id: string; payload: Record<string, unknown> }>(
      sql`select action, actor_id, payload from audit_log where target_id = ${targetId} and created_at = now() order by action`,
    ),
  );
}

interface People {
  admin: string;
  student: string;
  tutor: string;
}

async function people(tx: Executor, tutorEmail = "tutor5@nowtutors.dev"): Promise<People> {
  return {
    admin: await idOf(tx, "admin@nowtutors.dev"),
    student: await idOf(tx, "student2@nowtutors.dev"),
    tutor: await idOf(tx, tutorEmail),
  };
}

/** A scheduled booking `startInMinutes` from now (negative = in the past), charged through the ledger. */
async function paidBooking(
  tx: Executor,
  p: People,
  o: { status: string; startInMinutes: number; duration?: number; price?: number | null; charge?: boolean },
): Promise<string> {
  const id = randomUUID();
  const duration = o.duration ?? 60;
  const price = o.price === undefined ? 60 : o.price;
  await tx.execute(sql`
    insert into bookings (id, student_id, tutor_id, type, status, scheduled_start_at, scheduled_end_at,
                          duration_minutes, price_credits, payment_method,
                          student_joined_at, tutor_joined_at, started_at)
    values (${id}, ${p.student}, ${p.tutor}, 'scheduled', ${o.status}::booking_status,
            now() + make_interval(mins => ${o.startInMinutes}),
            now() + make_interval(mins => ${o.startInMinutes + duration}),
            ${duration}, ${price}, 'credits', null, null, null)
  `);
  if (o.charge !== false && price) {
    await debitWallet(walletExecutor(tx), {
      userId: p.student,
      amount: price,
      type: "booking_debit",
      referenceType: "booking",
      referenceId: id,
    });
  }
  return id;
}

async function earning(tx: Executor, bookingId: string, tutorId: string, status: string) {
  await tx.execute(sql`
    insert into tutor_earnings (tutor_id, booking_id, gross_credits, platform_fee_credits, net_credits, status, available_at)
    values (${tutorId}, ${bookingId}, 60, 15, 45, ${status}::earning_status, now() - interval '1 hour')
  `);
}

async function release(tx: Executor, tutorId: string, bookingId: string) {
  await creditWallet(walletExecutor(tx), {
    userId: tutorId,
    delta: 45,
    type: "session_earning",
    referenceType: "booking",
    referenceId: bookingId,
  });
}

const cancel = (tx: Executor, p: People, bookingId: string, status: "cancelled_by_tutor" | "cancelled_by_student" = "cancelled_by_tutor") =>
  q.applyForceCancel(tx, { bookingId, status, note: "Test cancel", actorId: p.admin, refund: "credits" });

describe("applyForceCancel", () => {
  it("refunds what the booking debit took, once, frees the slot and audits", async () => {
    await rolledBack(async (tx) => {
      const p = await people(tx);
      const before = await balance(tx, p.student);
      const id = await paidBooking(tx, p, { status: "confirmed", startInMinutes: 60 * 24 * 30 });
      expect(await balance(tx, p.student)).toBe(before - 60);

      expect(await cancel(tx, p, id)).toEqual({ ok: true, refundedCredits: 60, tutorReversal: "none", netCredits: null });
      expect(await balance(tx, p.student)).toBe(before);
      expect((await rowsFor(tx, id)).map((r) => [r.type, r.delta])).toEqual([
        ["booking_debit", -60],
        ["booking_refund", 60],
      ]);
      expect(
        await one(tx, sql`select status, cancelled_by, cancellation_reason from bookings where id = ${id}`),
      ).toEqual({ status: "cancelled_by_tutor", cancelled_by: p.admin, cancellation_reason: "Test cancel" });
      expect(await audits(tx, id)).toMatchObject([
        {
          action: "booking.force_cancel",
          actor_id: p.admin,
          payload: { from: "confirmed", to: "cancelled_by_tutor", refund_via: "credits", refunded_credits: 60, tutor_reversal: "none" },
        },
      ]);

      // The same window is bookable again: the slot constraint ignores cancelled rows.
      await expect(paidBooking(tx, p, { status: "confirmed", startInMinutes: 60 * 24 * 30, charge: false })).resolves.toBeTruthy();

      expect(await cancel(tx, p, id, "cancelled_by_student")).toEqual({ ok: false, reason: "status", status: "cancelled_by_tutor" });
      expect((await rowsFor(tx, id)).filter((r) => r.type === "booking_refund")).toHaveLength(1);
      expect(await ledgerSumMatches(tx, p.student)).toBe(true);
    });
  });

  it("held earnings are reversed without touching the tutor's wallet", async () => {
    await rolledBack(async (tx) => {
      const p = await people(tx);
      const id = await paidBooking(tx, p, { status: "completed", startInMinutes: -180 });
      await earning(tx, id, p.tutor, "held");
      const tutorBefore = await balance(tx, p.tutor);

      expect(await cancel(tx, p, id)).toMatchObject({ ok: true, refundedCredits: 60, tutorReversal: "reverse_held", netCredits: 45 });
      expect((await one<{ status: string }>(tx, sql`select status from tutor_earnings where booking_id = ${id}`)).status).toBe("reversed");
      expect(await balance(tx, p.tutor)).toBe(tutorBefore);
      expect((await rowsFor(tx, id)).some((r) => r.user_id === p.tutor)).toBe(false);
    });
  });

  it("released earnings still in the wallet are taken back once, and the ledger still sums to the balance", async () => {
    await rolledBack(async (tx) => {
      const p = await people(tx);
      const id = await paidBooking(tx, p, { status: "completed", startInMinutes: -180 });
      await earning(tx, id, p.tutor, "available");
      const tutorBefore = await balance(tx, p.tutor);
      await release(tx, p.tutor, id);

      expect(await cancel(tx, p, id)).toMatchObject({ ok: true, tutorReversal: "debit_available" });
      expect(await balance(tx, p.tutor)).toBe(tutorBefore);
      expect((await rowsFor(tx, id)).filter((r) => r.user_id === p.tutor).map((r) => [r.type, r.delta])).toEqual([
        ["session_earning", 45],
        ["earning_reversal", -45],
      ]);
      expect((await one<{ status: string }>(tx, sql`select status from tutor_earnings where booking_id = ${id}`)).status).toBe("reversed");
      expect(await ledgerSumMatches(tx, p.tutor)).toBe(true);
    });
  });

  it("released earnings held by an open withdrawal, or already withdrawn, are absorbed", async () => {
    await rolledBack(async (tx) => {
      const p = await people(tx);
      const locked = await paidBooking(tx, p, { status: "completed", startInMinutes: -300 });
      await earning(tx, locked, p.tutor, "available");
      await release(tx, p.tutor, locked);
      const requestId = randomUUID();
      const held = await balance(tx, p.tutor);
      await tx.execute(sql`
        insert into withdrawal_requests (id, tutor_id, amount_credits, amount_usd, payout_destination, status)
        values (${requestId}, ${p.tutor}, ${held}, ${held}, 'fixture@paypal.dev', 'requested')
      `);
      await debitWallet(walletExecutor(tx), {
        userId: p.tutor,
        amount: held,
        type: "withdrawal_hold",
        referenceType: "withdrawal_request",
        referenceId: requestId,
      });

      expect(await cancel(tx, p, locked)).toMatchObject({ ok: true, tutorReversal: "absorb_locked" });
      expect((await one<{ status: string }>(tx, sql`select status from tutor_earnings where booking_id = ${locked}`)).status).toBe("available");
      expect((await rowsFor(tx, locked)).some((r) => r.type === "earning_reversal")).toBe(false);

      const paidOut = await paidBooking(tx, p, { status: "completed", startInMinutes: -480 });
      await earning(tx, paidOut, p.tutor, "withdrawn");
      expect(await cancel(tx, p, paidOut)).toMatchObject({ ok: true, tutorReversal: "absorb_withdrawn" });
      expect((await audits(tx, paidOut))[0]?.payload).toMatchObject({ tutor_reversal: "absorb_withdrawn", earning_status_before: "withdrawn" });
      expect(await ledgerSumMatches(tx, p.tutor)).toBe(true);
    });
  });

  it("a tutor no-show is refunded with nothing to reverse", async () => {
    await rolledBack(async (tx) => {
      const p = await people(tx);
      const id = await paidBooking(tx, p, { status: "no_show_tutor", startInMinutes: -180 });
      expect(await cancel(tx, p, id, "cancelled_by_tutor")).toEqual({ ok: true, refundedCredits: 60, tutorReversal: "none", netCredits: null });
    });
  });

  it("two admins cancelling the same booking: the second waits on the row lock and is refused; one refund", async () => {
    const [ids] = Array.from(
      await watcher.db.execute<{ admin: string; student: string; tutor: string; balance: number; started: string }>(sql`
        select (select id from profiles where email = 'admin@nowtutors.dev') as admin,
               (select id from profiles where email = 'student2@nowtutors.dev') as student,
               (select id from profiles where email = 'tutor6@nowtutors.dev') as tutor,
               (select credit_balance from wallets w join profiles p on p.id = w.user_id where p.email = 'student2@nowtutors.dev') as balance,
               now()::text as started
      `),
    );
    const p: People = { admin: ids.admin, student: ids.student, tutor: ids.tutor };
    let bookingId = "";
    await watcher.db.transaction(async (tx) => {
      bookingId = await paidBooking(tx, p, { status: "confirmed", startInMinutes: 60 * 24 * 40 });
    });

    try {
      const a = await beginTransaction(connA);
      const b = await beginTransaction(connB);
      try {
        expect(await cancel(a.tx, p, bookingId)).toMatchObject({ ok: true, refundedCredits: 60 });
        const second = cancel(b.tx, p, bookingId, "cancelled_by_student");
        await waitUntilBlockedBy(watcher, b.pid, a.pid);
        await a.commit();
        expect(await second).toEqual({ ok: false, reason: "status", status: "cancelled_by_tutor" });
        await b.commit();
      } catch (err) {
        await Promise.allSettled([a.rollback(), b.rollback()]);
        throw err;
      }
      const refunds = Array.from(
        await watcher.db.execute<{ n: number }>(
          sql`select count(*)::int as n from credit_transactions where type = 'booking_refund' and reference_id = ${bookingId}`,
        ),
      )[0];
      expect(refunds.n).toBe(1);
    } finally {
      await watcher.db.transaction(async (tx) => {
        await tx.execute(sql`delete from credit_transactions where reference_id = ${bookingId}`);
        await tx.execute(sql`update wallets set credit_balance = ${ids.balance} where user_id = ${ids.student}`);
        await tx.execute(sql`delete from audit_log where target_id = ${bookingId} and created_at >= ${ids.started}::timestamptz`);
        await tx.execute(sql`delete from bookings where id = ${bookingId}`);
      });
    }
    const restored = Array.from(
      await watcher.db.execute<{ b: number }>(sql`select credit_balance as b from wallets where user_id = ${ids.student}`),
    )[0];
    expect(restored.b).toBe(ids.balance);
  });
});

describe("applyForceComplete", () => {
  const settings = { platformFeePercent: 25, earningsHoldHours: 48 };

  it("a tutor no-show with proof becomes completed with a held earnings row from the shared split and hold", async () => {
    await rolledBack(async (tx) => {
      const p = await people(tx);
      const id = await paidBooking(tx, p, { status: "no_show_tutor", startInMinutes: -180 });
      await tx.execute(sql`update bookings set ended_at = scheduled_end_at where id = ${id}`);

      expect(await q.applyForceComplete(tx, { bookingId: id, note: "Tutor sent recording", actorId: p.admin, ...settings })).toEqual({
        ok: true,
        earningsCreated: true,
        netCredits: 45,
      });
      const row = await one<{ status: string; gross: number; fee: number; net: number; hold_ok: boolean; booking_status: string }>(
        tx,
        sql`select e.status, e.gross_credits as gross, e.platform_fee_credits as fee, e.net_credits as net,
                   abs(extract(epoch from e.available_at - (b.ended_at + interval '48 hours'))) < 0.001 as hold_ok, b.status as booking_status
              from tutor_earnings e join bookings b on b.id = e.booking_id where b.id = ${id}`,
      );
      expect(row).toEqual({ status: "held", gross: 60, fee: 15, net: 45, hold_ok: true, booking_status: "completed" });
      expect(await audits(tx, id)).toMatchObject([
        { action: "booking.force_complete", actor_id: p.admin, payload: { from: "no_show_tutor", earnings_created: true } },
      ]);
      expect(await q.applyForceComplete(tx, { bookingId: id, note: "Again please", actorId: p.admin, ...settings })).toEqual({
        ok: false,
        reason: "status",
        status: "completed",
      });
    });
  });

  it("a stuck past session gets ended_at = scheduled end; a student no-show keeps its one earnings row", async () => {
    await rolledBack(async (tx) => {
      const p = await people(tx);
      const stuck = await paidBooking(tx, p, { status: "in_progress", startInMinutes: -200 });
      expect(await q.applyForceComplete(tx, { bookingId: stuck, note: "Cron missed it", actorId: p.admin, ...settings })).toMatchObject({
        ok: true,
        earningsCreated: true,
      });
      expect((await one<{ same: boolean }>(tx, sql`select ended_at = scheduled_end_at as same from bookings where id = ${stuck}`)).same).toBe(true);

      const studentNoShow = await paidBooking(tx, p, { status: "no_show_student", startInMinutes: -400 });
      await earning(tx, studentNoShow, p.tutor, "held");
      expect(
        await q.applyForceComplete(tx, { bookingId: studentNoShow, note: "Student was there", actorId: p.admin, ...settings }),
      ).toEqual({ ok: true, earningsCreated: false, netCredits: 45 });
      expect((await one<{ n: number }>(tx, sql`select count(*)::int as n from tutor_earnings where booking_id = ${studentNoShow}`)).n).toBe(1);
    });
  });

  it("refuses a future session, a cancelled one and one with no price, changing nothing", async () => {
    await rolledBack(async (tx) => {
      const p = await people(tx);
      const future = await paidBooking(tx, p, { status: "confirmed", startInMinutes: 60 * 24 * 20 });
      expect(await q.applyForceComplete(tx, { bookingId: future, note: "Too early", actorId: p.admin, ...settings })).toEqual({
        ok: false,
        reason: "too_early",
      });
      const noPrice = await paidBooking(tx, p, { status: "no_show_tutor", startInMinutes: -100, price: null });
      expect(await q.applyForceComplete(tx, { bookingId: noPrice, note: "No price", actorId: p.admin, ...settings })).toEqual({
        ok: false,
        reason: "no_price",
      });
      expect((await one<{ status: string }>(tx, sql`select status from bookings where id = ${noPrice}`)).status).toBe("no_show_tutor");
      await cancel(tx, p, future);
      expect(await q.applyForceComplete(tx, { bookingId: future, note: "Cancelled", actorId: p.admin, ...settings })).toMatchObject({
        ok: false,
        reason: "status",
      });
    });
  });
});

describe("applyRefundReversal", () => {
  async function payment(
    tx: Executor,
    p: People,
    o: { status: string; purpose: "credit_purchase" | "booking"; credits: number; bookingId?: string; mint?: boolean },
  ): Promise<string> {
    const id = randomUUID();
    await tx.execute(sql`
      insert into payments (id, user_id, provider_order_id, amount_usd, credits_granted, purpose, booking_id, status)
      values (${id}, ${p.student}, ${"TEST-" + id}, 39.99, ${o.credits}, ${o.purpose}::payment_purpose,
              ${o.bookingId ?? null}, ${o.status}::payment_status)
    `);
    if (o.mint !== false) {
      await creditWallet(walletExecutor(tx), {
        userId: p.student,
        delta: o.credits,
        type: "purchase",
        referenceType: "payment",
        referenceId: id,
      });
    }
    return id;
  }

  const reverse = (tx: Executor, p: People, paymentId: string) =>
    q.applyRefundReversal(tx, { paymentId, note: "Full refund in PayPal", actorId: p.admin });

  it("a refunded credit package: takes the minted credits back once; a captured one is refused", async () => {
    await rolledBack(async (tx) => {
      const p = await people(tx);
      const before = await balance(tx, p.student);
      const pay = await payment(tx, p, { status: "refunded", purpose: "credit_purchase", credits: 30 });

      expect(await reverse(tx, p, pay)).toEqual({ ok: true, kind: "take_credits", taken: 30, shortfall: 0 });
      expect(await balance(tx, p.student)).toBe(before);
      expect((await rowsFor(tx, pay)).map((r) => [r.type, r.delta])).toEqual([
        ["purchase", 30],
        ["purchase_reversal", -30],
      ]);
      expect((await audits(tx, pay))[0]).toMatchObject({ action: "payment.reverse_refund", payload: { plan: "take_credits", taken: 30 } });
      expect(await reverse(tx, p, pay)).toEqual({ ok: false, reason: "already_reversed" });

      const captured = await payment(tx, p, { status: "captured", purpose: "credit_purchase", credits: 30 });
      expect(await reverse(tx, p, captured)).toEqual({ ok: false, reason: "not_refunded" });
      const nothing = await payment(tx, p, { status: "refunded", purpose: "credit_purchase", credits: 30, mint: false });
      expect(await reverse(tx, p, nothing)).toEqual({ ok: false, reason: "not_minted" });
      expect(await ledgerSumMatches(tx, p.student)).toBe(true);
    });
  });

  it("credits already spent: takes what's left and records the shortfall", async () => {
    await rolledBack(async (tx) => {
      const p = await people(tx);
      const pay = await payment(tx, p, { status: "refunded", purpose: "credit_purchase", credits: 30 });
      const spend = (await balance(tx, p.student)) - 10;
      await debitWallet(walletExecutor(tx), { userId: p.student, amount: spend, type: "booking_debit", referenceType: "booking", referenceId: randomUUID() });

      expect(await reverse(tx, p, pay)).toEqual({ ok: true, kind: "take_credits", taken: 10, shortfall: 20 });
      expect(await balance(tx, p.student)).toBe(0);
      expect((await audits(tx, pay))[0]?.payload).toMatchObject({ taken: 10, shortfall: 20 });
    });
  });

  it("a refunded direct payment for a confirmed booking cancels it without a second refund", async () => {
    await rolledBack(async (tx) => {
      const p = await people(tx);
      const before = await balance(tx, p.student);
      const bookingId = await paidBooking(tx, p, { status: "confirmed", startInMinutes: 60 * 24 * 25, charge: false });
      const pay = await payment(tx, p, { status: "refunded", purpose: "booking", credits: 60, bookingId });
      await debitWallet(walletExecutor(tx), { userId: p.student, amount: 60, type: "booking_debit", referenceType: "booking", referenceId: bookingId });

      expect(await reverse(tx, p, pay)).toEqual({ ok: true, kind: "cancel_booking", bookingId, tutorReversal: "none" });
      expect((await one<{ status: string }>(tx, sql`select status from bookings where id = ${bookingId}`)).status).toBe("cancelled_by_student");
      expect((await rowsFor(tx, bookingId)).map((r) => r.type)).toEqual(["booking_debit"]);
      expect((await rowsFor(tx, pay)).map((r) => r.type)).toEqual(["purchase"]);
      expect(await balance(tx, p.student)).toBe(before);
      expect((await audits(tx, bookingId))[0]?.payload).toMatchObject({ refund_via: "paypal", refunded_credits: 0 });
      expect((await audits(tx, pay))[0]?.payload).toMatchObject({ plan: "cancel_booking", booking_id: bookingId });
    });
  });

  it("a direct payment whose booking was already refunded in credits takes the credits back instead", async () => {
    await rolledBack(async (tx) => {
      const p = await people(tx);
      const bookingId = await paidBooking(tx, p, { status: "confirmed", startInMinutes: 60 * 24 * 26, charge: false });
      const pay = await payment(tx, p, { status: "refunded", purpose: "booking", credits: 60, bookingId });
      await debitWallet(walletExecutor(tx), { userId: p.student, amount: 60, type: "booking_debit", referenceType: "booking", referenceId: bookingId });
      await cancel(tx, p, bookingId, "cancelled_by_student");

      expect(await reverse(tx, p, pay)).toEqual({ ok: true, kind: "take_credits", taken: 60, shortfall: 0 });
      expect(await ledgerSumMatches(tx, p.student)).toBe(true);
    });
  });
});

describe("reads", () => {
  it("the list filters by status, participant and date, and the detail carries earnings and ledger", async () => {
    await rolledBack(async (tx) => {
      const p = await people(tx, "tutor7@nowtutors.dev");
      const id = await paidBooking(tx, p, { status: "completed", startInMinutes: -60 * 24 * 3 });
      await earning(tx, id, p.tutor, "held");
      const day = (await one<{ d: string }>(tx, sql`select to_char((now() - interval '3 days') at time zone 'UTC', 'YYYY-MM-DD') as d`)).d;

      const hit = await q.listAdminBookings({ status: "completed", q: "tutor7@", from: day, to: day, timeZone: "UTC" });
      expect(hit.bookings.map((b) => b.id)).toContain(id);
      expect(hit.bookings.every((b) => b.status === "completed")).toBe(true);
      expect((await q.listAdminBookings({ status: "confirmed", q: "tutor7@", from: day, to: day, timeZone: "UTC" })).bookings.map((b) => b.id)).not.toContain(id);
      expect((await q.listAdminBookings({ status: null, q: "%", from: null, to: null, timeZone: "UTC" })).total).toBe(0);

      const detail = await q.getAdminBookingDetail(id);
      expect(detail).toMatchObject({ status: "completed", tutorEmail: "tutor7@nowtutors.dev", earning: { status: "held", netCredits: 45 } });
      expect(detail!.ledger.map((l) => l.type)).toEqual(["booking_debit"]);
      expect(await q.getAdminBookingDetail(randomUUID())).toBeNull();
    });
  });
});
