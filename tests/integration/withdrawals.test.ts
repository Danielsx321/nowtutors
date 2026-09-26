import { sql, type SQL } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  beginTransaction,
  createFixtureBooking,
  createFixtureEarning,
  deleteFixtureBooking,
  openConnection,
  readEarningById,
  readWalletBalance,
  waitUntilBlockedBy,
  withExecutor,
  type TestConnection,
} from "./helpers/test-db";

/**
 * Withdrawals against a real Postgres (SPEC §7.11; Phase 8 Part 2). Test
 * project only.
 *
 * **Why these cannot be unit tests.** "Two requests from one tutor produce one
 * hold" and "a double-clicked Mark paid transitions once" are properties of the
 * wallet and request row locks and of the one-open partial unique index
 * (`drizzle/0015`). The in-memory fake in `tests/unit/withdrawals.test.ts`
 * models the rules, not the locks.
 *
 * **Each race is a genuine contest.** Connection A runs the shipped function
 * and holds its transaction open; B runs the same function and blocks; Postgres
 * confirms the block (`pg_blocking_pids`) before A commits. Two sequential
 * awaits would pass against an implementation with no lock at all.
 *
 * `@/db` is mocked to forward to the current transaction, `transaction()`
 * included, exactly as `release-earnings.test.ts` does: the shipped runner's
 * `db.transaction` becomes a savepoint inside the held transaction, so the row
 * locks belong to the outer one and are held until it commits.
 *
 * **Teardown restores `credit_balance = sum(delta)`.** Every row this file
 * writes for the tutor is removed and the wallet put back in ONE transaction,
 * for the reason `resetEarningsFixture` gives: a half-restored wallet on a
 * shared project is the drift `reconcile-wallets` exists to alarm on.
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

const { withdrawalRunner } = await import("@/db/queries/withdrawals");
const { approveWithdrawal, markWithdrawalPaid, rejectWithdrawal, requestWithdrawal } =
  await import("@/lib/withdrawals/withdrawals");
const { creditWallet, pgErrorCode, walletExecutor } = await import(
  "@/lib/credits/ledger"
);

const SETTINGS = { minWithdrawalUsd: 30, payoutUsdPerCredit: 1 };
const FUNDING = 40;

let alpha: TestConnection;
let beta: TestConnection;
let watcher: TestConnection;
let tutorId: string;
let adminId: string;
let previousBalance: number | null;
let startedAt: string;
let bookingIds: string[];

beforeAll(async () => {
  alpha = openConnection("alpha");
  beta = openConnection("beta");
  watcher = openConnection("watcher");
  const [row] = await watcher.db.execute<{ tutor_id: string; admin_id: string }>(sql`
    select (select p.id from profiles p
              join tutor_payout_details d on d.tutor_id = p.id and d.paypal_email is not null
             where p.role = 'tutor' order by p.created_at limit 1) as tutor_id,
           (select id from profiles where role = 'admin' order by created_at limit 1) as admin_id
  `);
  if (!row?.tutor_id || !row?.admin_id) {
    throw new Error(
      "The test project needs a seeded tutor with a PayPal email and an admin. " +
        "Run `pnpm db:seed:test` first (docs/RUNBOOK.md, 'Test Supabase project').",
    );
  }
  tutorId = row.tutor_id;
  adminId = row.admin_id;
});

afterAll(async () => {
  await Promise.all([alpha.end(), beta.end(), watcher.end()]);
});

beforeEach(async () => {
  bookingIds = [];
  const [open] = await watcher.db.execute<{ n: number }>(sql`
    select count(*)::int as n from withdrawal_requests
     where tutor_id = ${tutorId} and status in ('requested', 'approved')
  `);
  if (Number(open.n) > 0) {
    throw new Error(
      `Tutor ${tutorId} already has an open withdrawal request on the test ` +
        "project, left by an earlier run. Remove it before running this lane.",
    );
  }
  previousBalance = await readWalletBalance(watcher, tutorId);
  const [now] = await watcher.db.execute<{ now: string }>(
    sql`select now()::text as now`,
  );
  startedAt = now.now;
});

afterEach(async () => {
  await watcher.db.transaction(async (tx) => {
    await tx.execute(sql`
      delete from audit_log
       where target_type = 'withdrawal_request'
         and created_at >= ${startedAt}::timestamptz
    `);
    await tx.execute(sql`
      delete from withdrawal_requests
       where tutor_id = ${tutorId} and created_at >= ${startedAt}::timestamptz
    `);
    await tx.execute(sql`
      delete from credit_transactions
       where user_id = ${tutorId} and created_at >= ${startedAt}::timestamptz
    `);
    if (previousBalance === null) {
      await tx.execute(sql`delete from wallets where user_id = ${tutorId}`);
    } else {
      await tx.execute(sql`
        update wallets set credit_balance = ${previousBalance} where user_id = ${tutorId}
      `);
    }
  });
  for (const id of bookingIds) await deleteFixtureBooking(alpha, id);
});

/** Run `fn` against the shipped code in one committed transaction on `conn`. */
async function committed<T>(conn: TestConnection, fn: () => Promise<T>): Promise<T> {
  const held = await beginTransaction(conn);
  try {
    const result = await withExecutor(held.tx, fn);
    await held.commit();
    return result;
  } catch (err) {
    await held.rollback();
    throw err;
  }
}

async function fund(
  delta: number,
  params: { type?: "admin_adjustment" | "session_earning"; referenceId?: string } = {},
) {
  await alpha.db.transaction(async (tx) => {
    await creditWallet(walletExecutor(tx), {
      userId: tutorId,
      delta,
      type: params.type ?? "admin_adjustment",
      referenceType: params.referenceId ? "booking" : null,
      referenceId: params.referenceId ?? null,
      description: "withdrawals DB lane funding",
    });
  });
}

async function countLedger(type: string, referenceId: string): Promise<number> {
  const [r] = await watcher.db.execute<{ n: number }>(sql`
    select count(*)::int as n from credit_transactions
     where type = ${type}::credit_transaction_type and reference_id = ${referenceId}
  `);
  return Number(r.n);
}

async function readRequest(id: string) {
  const [r] = await watcher.db.execute<{ status: string; external_reference: string | null }>(sql`
    select status::text, external_reference from withdrawal_requests where id = ${id}
  `);
  return r ?? null;
}

async function ledgerSum(): Promise<number> {
  const [r] = await watcher.db.execute<{ s: number }>(sql`
    select coalesce(sum(delta), 0)::int as s from credit_transactions where user_id = ${tutorId}
  `);
  return Number(r.s);
}

async function requestCommitted() {
  const res = await committed(alpha, () =>
    requestWithdrawal(withdrawalRunner, { tutorId, settings: SETTINGS }),
  );
  if (!res.ok) throw new Error(`request refused: ${res.reason}`);
  return res.withdrawal;
}

describe("requestWithdrawal under concurrency", () => {
  it("two racing requests produce one request and one hold", async () => {
    await fund(FUNDING);
    const funded = (await readWalletBalance(watcher, tutorId))!;

    const a = await beginTransaction(alpha);
    const b = await beginTransaction(beta);
    try {
      const first = await withExecutor(a.tx, () =>
        requestWithdrawal(withdrawalRunner, { tutorId, settings: SETTINGS }),
      );
      expect(first).toMatchObject({ ok: true, withdrawal: { amountCredits: funded } });

      const second = withExecutor(b.tx, () =>
        requestWithdrawal(withdrawalRunner, { tutorId, settings: SETTINGS }),
      );
      await waitUntilBlockedBy(watcher, b.pid, a.pid);
      await a.commit();

      // B waited on A's wallet lock, then saw A's open request.
      expect(await second).toEqual({ ok: false, reason: "already_open" });
      await b.commit();
    } catch (err) {
      await Promise.allSettled([a.rollback(), b.rollback()]);
      throw err;
    }

    const [open] = await watcher.db.execute<{ n: number }>(sql`
      select count(*)::int as n from withdrawal_requests
       where tutor_id = ${tutorId} and status = 'requested'
    `);
    expect(Number(open.n)).toBe(1);
    const [holds] = await watcher.db.execute<{ n: number }>(sql`
      select count(*)::int as n from credit_transactions
       where user_id = ${tutorId} and type = 'withdrawal_hold'
         and created_at >= ${startedAt}::timestamptz
    `);
    expect(Number(holds.n)).toBe(1);
    expect(await readWalletBalance(watcher, tutorId)).toBe(0);
    expect(await ledgerSum()).toBe(0);
  });

  it("the one-open index refuses a second open row even without the lock", async () => {
    // Bypasses the service on purpose: this is the database guarantee that
    // holds if a future write path forgets the wallet lock.
    await watcher.db.execute(sql`
      insert into withdrawal_requests (tutor_id, amount_credits, amount_usd, payout_destination)
      values (${tutorId}, 1, '1.00', 'lane@paypal.dev')
    `);
    const refused = await watcher.db
      .execute(sql`
        insert into withdrawal_requests (tutor_id, amount_credits, amount_usd, payout_destination, status)
        values (${tutorId}, 1, '1.00', 'lane@paypal.dev', 'approved')
      `)
      .then(
        () => null,
        (err: unknown) => err,
      );
    expect(pgErrorCode(refused)).toBe("23505");
  });
});

describe("admin transitions under concurrency", () => {
  it("a double Mark paid transitions once", async () => {
    await fund(FUNDING);
    const w = await requestCommitted();
    await committed(alpha, () => approveWithdrawal(withdrawalRunner, { id: w.id, adminId }));

    const a = await beginTransaction(alpha);
    const b = await beginTransaction(beta);
    try {
      const pay = () =>
        markWithdrawalPaid(withdrawalRunner, { id: w.id, adminId, externalReference: "LANE-1" });
      expect(await withExecutor(a.tx, pay)).toMatchObject({ ok: true });
      const second = withExecutor(b.tx, pay);
      await waitUntilBlockedBy(watcher, b.pid, a.pid);
      await a.commit();
      expect(await second).toEqual({ ok: false, reason: "wrong_status", status: "paid" });
      await b.commit();
    } catch (err) {
      await Promise.allSettled([a.rollback(), b.rollback()]);
      throw err;
    }

    expect(await readRequest(w.id)).toEqual({ status: "paid", external_reference: "LANE-1" });
    const [audits] = await watcher.db.execute<{ n: number }>(sql`
      select count(*)::int as n from audit_log
       where target_id = ${w.id} and action = 'withdrawal.mark_paid'
    `);
    expect(Number(audits.n)).toBe(1);
    // Paid writes no ledger row: the hold was the debit.
    expect(await countLedger("withdrawal_paid", w.id)).toBe(0);
    expect(await readWalletBalance(watcher, tutorId)).toBe(await ledgerSum());
  });

  it("a double Reject returns the credits once", async () => {
    await fund(FUNDING);
    const funded = (await readWalletBalance(watcher, tutorId))!;
    const w = await requestCommitted();

    const a = await beginTransaction(alpha);
    const b = await beginTransaction(beta);
    try {
      const reject = () =>
        rejectWithdrawal(withdrawalRunner, { id: w.id, adminId, note: "DB lane reject" });
      expect(await withExecutor(a.tx, reject)).toEqual({ ok: true });
      const second = withExecutor(b.tx, reject);
      await waitUntilBlockedBy(watcher, b.pid, a.pid);
      await a.commit();
      expect(await second).toEqual({ ok: false, reason: "wrong_status", status: "rejected" });
      await b.commit();
    } catch (err) {
      await Promise.allSettled([a.rollback(), b.rollback()]);
      throw err;
    }

    expect(await countLedger("withdrawal_reversed", w.id)).toBe(1);
    expect(await readWalletBalance(watcher, tutorId)).toBe(funded);
    expect(await ledgerSum()).toBe(funded);
  });
});

describe("mark paid and earnings rows", () => {
  it("flips the rows the request claimed, and leaves a release that came after it available (M12)", async () => {
    const before = await createFixtureBooking(alpha, { startedMinutesAgo: 120, status: "completed" });
    bookingIds.push(before.bookingId);
    const earlyEarning = await createFixtureEarning(alpha, {
      bookingId: before.bookingId,
      tutorId,
      status: "available",
    });
    await fund(38, { type: "session_earning", referenceId: before.bookingId });

    const w = await committed(alpha, () =>
      requestWithdrawal(withdrawalRunner, {
        tutorId,
        settings: { minWithdrawalUsd: 0, payoutUsdPerCredit: 1 },
      }),
    );
    if (!w.ok) throw new Error(`request refused: ${w.reason}`);

    const after = await createFixtureBooking(alpha, { startedMinutesAgo: 60, status: "completed" });
    bookingIds.push(after.bookingId);
    const lateEarning = await createFixtureEarning(alpha, {
      bookingId: after.bookingId,
      tutorId,
      status: "available",
    });
    await fund(38, { type: "session_earning", referenceId: after.bookingId });

    await committed(alpha, () =>
      approveWithdrawal(withdrawalRunner, { id: w.withdrawal.id, adminId }),
    );
    const paid = await committed(alpha, () =>
      markWithdrawalPaid(withdrawalRunner, {
        id: w.withdrawal.id,
        adminId,
        externalReference: "LANE-2",
      }),
    );

    expect(paid).toMatchObject({ ok: true, earningsWithdrawn: 1 });
    expect((await readEarningById(watcher, earlyEarning))?.status).toBe("withdrawn");
    expect((await readEarningById(watcher, lateEarning))?.status).toBe("available");
    // The late credit is still in the wallet, and the wallet agrees with the ledger.
    expect(await readWalletBalance(watcher, tutorId)).toBe(38);
    expect(await ledgerSum()).toBe(38);
  });
});
