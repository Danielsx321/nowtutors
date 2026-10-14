import { sql, type SQL } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginTransaction,
  openConnection,
  readWalletBalance,
  withExecutor,
  type TestConnection,
} from "./helpers/test-db";

/**
 * The weekly availability bonus against a real Postgres (SPEC §4.4, §7.5, §12;
 * availability-bonus, 2026-10-14).
 *
 * What only the database can prove here: the heartbeat's upsert adds to the
 * day bucket; the Monday job's claim is the `availability_bonus_awards` unique
 * index plus the ledger's unique `(type, reference_id)`, so a week is paid once
 * however many times the job runs; the qualifier query honours approval and
 * suspension; and the wallet cache moves by exactly the credit.
 *
 * `@/db` is mocked to forward to the current transaction, as in
 * `release-earnings.test.ts`. The shipped `touchPresence` and
 * `availabilityBonusPort` run unmodified; the writes are read back through a
 * separate connection.
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

const { touchPresence } = await import("@/db/queries/presence");
const { availabilityBonusPort } = await import("@/db/queries/availability-bonus");
const { runAvailabilityBonus } = await import("@/lib/availability-bonus/award");

const MONDAY = new Date("2026-10-19T00:20:00Z");
const LAST_WEEK = "2026-10-12";
const SETTINGS = { enabled: true, minHours: 5, credits: 40 };

let alpha: TestConnection;
let watcher: TestConnection;
let tutorId: string;
let previousBalance: number | null;
let previous: { isLive: boolean; lastSeenAt: Date | null; approval: string; suspended: boolean };

async function seededTutor(conn: TestConnection) {
  const rows = await conn.db.execute<{
    id: string;
    is_live: boolean;
    last_seen_at: Date | null;
    approval_status: string;
    is_suspended: boolean;
  }>(sql`
    select p.id, tp.is_live, tp.last_seen_at, tp.approval_status, p.is_suspended
      from profiles p join tutor_profiles tp on tp.user_id = p.id
     where p.role = 'tutor'
     order by p.created_at
     limit 1
  `);
  const row = rows[0];
  if (!row) throw new Error("The test project has no seeded tutor. Run `pnpm db:seed:test` first.");
  return row;
}

/** Run `fn` inside one committed transaction on `conn`, with `@/db` bound to it. */
async function inTransaction<T>(conn: TestConnection, fn: () => Promise<T>): Promise<T> {
  const held = await beginTransaction(conn);
  try {
    const out = await withExecutor(held.tx, fn);
    await held.commit();
    return out;
  } catch (err) {
    await held.rollback();
    throw err;
  }
}

beforeAll(() => {
  alpha = openConnection("alpha");
  watcher = openConnection("watcher");
});

afterAll(async () => {
  await Promise.all([alpha.end(), watcher.end()]);
});

beforeEach(async () => {
  const t = await seededTutor(watcher);
  tutorId = t.id;
  previous = {
    isLive: t.is_live,
    lastSeenAt: t.last_seen_at,
    approval: t.approval_status,
    suspended: t.is_suspended,
  };
  previousBalance = await readWalletBalance(watcher, tutorId);
  await watcher.db.execute(sql`
    update tutor_profiles set approval_status = 'approved', is_live = false, live_mode = null
     where user_id = ${tutorId}
  `);
  await watcher.db.execute(sql`update profiles set is_suspended = false where id = ${tutorId}`);
});

afterEach(async () => {
  await watcher.db.transaction(async (tx) => {
    await tx.execute(sql`delete from availability_bonus_awards where tutor_id = ${tutorId}`);
    await tx.execute(
      sql`delete from credit_transactions where type = 'availability_bonus' and user_id = ${tutorId}`,
    );
    await tx.execute(sql`delete from tutor_online_time where tutor_id = ${tutorId}`);
    await tx.execute(sql`delete from audit_log where action = 'bonus.award_run'`);
    if (previousBalance === null) {
      await tx.execute(sql`delete from wallets where user_id = ${tutorId}`);
    } else {
      await tx.execute(sql`update wallets set credit_balance = ${previousBalance} where user_id = ${tutorId}`);
    }
    await tx.execute(sql`
      update tutor_profiles
         set approval_status = ${previous.approval}::tutor_approval_status,
             is_live = ${previous.isLive},
             live_mode = null,
             last_seen_at = ${previous.lastSeenAt}
       where user_id = ${tutorId}
    `);
    await tx.execute(sql`update profiles set is_suspended = ${previous.suspended} where id = ${tutorId}`);
  });
});

async function readDay(day: string): Promise<number | null> {
  const rows = await watcher.db.execute<{ seconds: number }>(
    sql`select seconds from tutor_online_time where tutor_id = ${tutorId} and day = ${day}`,
  );
  return rows[0] ? Number(rows[0].seconds) : null;
}

async function setWeekSeconds(weekStart: string, seconds: number) {
  await watcher.db.execute(sql`
    insert into tutor_online_time (tutor_id, day, seconds) values (${tutorId}, ${weekStart}::date, ${seconds})
    on conflict (tutor_id, day) do update set seconds = excluded.seconds
  `);
}

async function readAwards() {
  return watcher.db.execute<{ week_start: string; credits: number; transaction_id: string | null }>(
    sql`select week_start::text, credits, transaction_id from availability_bonus_awards where tutor_id = ${tutorId} order by week_start`,
  );
}

async function readBonusLedger() {
  return watcher.db.execute<{ delta: number; reference_id: string }>(
    sql`select delta, reference_id from credit_transactions where type = 'availability_bonus' and user_id = ${tutorId}`,
  );
}

describe("the heartbeat records live time", () => {
  it("a live tutor's beat adds the gap since the previous beat, capped at the window", async () => {
    const today = new Date().toISOString().slice(0, 10);
    // Live, last seen 30 s ago.
    await watcher.db.execute(sql`
      update tutor_profiles set is_live = true, live_mode = 'instant', last_seen_at = now() - interval '30 seconds'
       where user_id = ${tutorId}
    `);
    const first = await inTransaction(alpha, () => touchPresence(tutorId, "tutor"));
    expect(first.tutorTouched).toBe(true);
    expect(first.accruedSeconds).toBeGreaterThanOrEqual(29);
    expect(first.accruedSeconds).toBeLessThanOrEqual(31);
    expect(await readDay(today)).toBe(first.accruedSeconds);

    // A long gap: only the window is credited.
    await watcher.db.execute(sql`
      update tutor_profiles set last_seen_at = now() - interval '45 minutes' where user_id = ${tutorId}
    `);
    const second = await inTransaction(alpha, () => touchPresence(tutorId, "tutor"));
    expect(second.accruedSeconds).toBe(120);
    expect(await readDay(today)).toBe(first.accruedSeconds + 120);
  });

  it("an offline tutor's beat bumps last_seen_at and records nothing", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await watcher.db.execute(sql`
      update tutor_profiles set is_live = false, live_mode = null, last_seen_at = now() - interval '30 seconds'
       where user_id = ${tutorId}
    `);
    const r = await inTransaction(alpha, () => touchPresence(tutorId, "tutor"));
    expect(r).toEqual({ tutorTouched: true, accruedSeconds: 0 });
    expect(await readDay(today)).toBeNull();
  });
});

describe("the Monday job pays a week once", () => {
  it("credits 40 for 5 hours, records the award with its ledger row, and a second run pays nothing", async () => {
    await setWeekSeconds(LAST_WEEK, 5 * 3600);
    const before = (await readWalletBalance(watcher, tutorId)) ?? 0;

    const first = await inTransaction(alpha, () =>
      runAvailabilityBonus(availabilityBonusPort, SETTINGS, MONDAY),
    );
    expect(first.awarded.map((a) => [a.tutorId, a.weekStart, a.credits])).toEqual([[tutorId, LAST_WEEK, 40]]);
    expect(await readWalletBalance(watcher, tutorId)).toBe(before + 40);

    const awards = await readAwards();
    expect(awards).toHaveLength(1);
    expect(awards[0].week_start).toBe(LAST_WEEK);
    const ledger = await readBonusLedger();
    expect(ledger).toHaveLength(1);
    expect(Number(ledger[0].delta)).toBe(40);
    expect(awards[0].transaction_id).not.toBeNull();

    const again = await inTransaction(alpha, () =>
      runAvailabilityBonus(availabilityBonusPort, SETTINGS, MONDAY),
    );
    expect(again.awarded).toHaveLength(0);
    expect(await readWalletBalance(watcher, tutorId)).toBe(before + 40);
    expect(await readAwards()).toHaveLength(1);
    expect(await readBonusLedger()).toHaveLength(1);
  });

  it("the award unique index refuses a second award row for the same week, and the ledger stays at one", async () => {
    await setWeekSeconds(LAST_WEEK, 5 * 3600);
    await inTransaction(alpha, () => runAvailabilityBonus(availabilityBonusPort, SETTINGS, MONDAY));

    // Try to claim the week again directly through the port: the row exists,
    // so the claim returns null and the credit callback never runs.
    let credited = false;
    const out = await inTransaction(alpha, () =>
      availabilityBonusPort.claimAndCredit(
        { tutorId, weekStart: LAST_WEEK, liveSeconds: 18_000, credits: 40 },
        async () => {
          credited = true;
          return "paid";
        },
      ),
    );
    expect(out).toBeNull();
    expect(credited).toBe(false);
    expect(await readBonusLedger()).toHaveLength(1);
  });

  it("under the threshold, unapproved or suspended: nothing", async () => {
    await setWeekSeconds(LAST_WEEK, 5 * 3600 - 1);
    let r = await inTransaction(alpha, () => runAvailabilityBonus(availabilityBonusPort, SETTINGS, MONDAY));
    expect(r.awarded).toHaveLength(0);

    await setWeekSeconds(LAST_WEEK, 6 * 3600);
    await watcher.db.execute(sql`update tutor_profiles set approval_status = 'changes_requested' where user_id = ${tutorId}`);
    r = await inTransaction(alpha, () => runAvailabilityBonus(availabilityBonusPort, SETTINGS, MONDAY));
    expect(r.awarded).toHaveLength(0);

    await watcher.db.execute(sql`update tutor_profiles set approval_status = 'approved' where user_id = ${tutorId}`);
    await watcher.db.execute(sql`update profiles set is_suspended = true where id = ${tutorId}`);
    r = await inTransaction(alpha, () => runAvailabilityBonus(availabilityBonusPort, SETTINGS, MONDAY));
    expect(r.awarded).toHaveLength(0);

    expect(await readAwards()).toHaveLength(0);
    expect(await readBonusLedger()).toHaveLength(0);
  });
});
