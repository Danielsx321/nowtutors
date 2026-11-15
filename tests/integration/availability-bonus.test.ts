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
 * The monthly availability bonus against a real Postgres (SPEC §4.4, §7.5, §12;
 * availability-bonus 2026-10-14, monthly since 2026-11-15).
 *
 * What only the database can prove here: the heartbeat's upsert adds to the
 * day bucket; the monthly job's claim is the `availability_bonus_monthly_awards`
 * unique index plus the ledger's unique `(type, reference_id)`, so a month is
 * paid once however many times the job runs; the qualifier query sums a whole
 * UTC month, honours approval and suspension, and reads weekly credits paid for
 * weeks starting in the month; and the wallet cache moves by exactly the credit.
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

const DEC_1 = new Date("2026-12-01T00:20:00Z");
const NOV = "2026-11-01";
const SETTINGS = { enabled: true, minHours: 20, credits: 100 };

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
    await tx.execute(sql`delete from availability_bonus_monthly_awards where tutor_id = ${tutorId}`);
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

async function setDaySeconds(day: string, seconds: number) {
  await watcher.db.execute(sql`
    insert into tutor_online_time (tutor_id, day, seconds) values (${tutorId}, ${day}::date, ${seconds})
    on conflict (tutor_id, day) do update set seconds = excluded.seconds
  `);
}

/** Spread `hours` across two November days so the month sum is what is tested. */
async function setNovemberHours(hours: number) {
  const secs = Math.round(hours * 3600);
  await setDaySeconds("2026-11-03", Math.floor(secs / 2));
  await setDaySeconds("2026-11-29", secs - Math.floor(secs / 2));
}

/** A paid weekly award row, as the old Monday job left them. */
async function insertWeeklyAward(weekStart: string, credits: number) {
  await watcher.db.execute(sql`
    insert into availability_bonus_awards (tutor_id, week_start, live_seconds, credits)
    values (${tutorId}, ${weekStart}::date, 18000, ${credits})
  `);
}

async function readAwards() {
  return watcher.db.execute<{
    month_start: string;
    credits: number;
    weekly_credits_deducted: number;
    transaction_id: string | null;
  }>(
    sql`select month_start::text, credits, weekly_credits_deducted, transaction_id
          from availability_bonus_monthly_awards where tutor_id = ${tutorId} order by month_start`,
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

describe("the monthly job pays a month once", () => {
  it("credits 100 for 20 hours in November, records the award with its ledger row, and a second run pays nothing", async () => {
    await setNovemberHours(20);
    const before = (await readWalletBalance(watcher, tutorId)) ?? 0;

    const first = await inTransaction(alpha, () => runAvailabilityBonus(availabilityBonusPort, SETTINGS, DEC_1));
    expect(first.awarded.map((a) => [a.tutorId, a.monthStart, a.credits])).toEqual([[tutorId, NOV, 100]]);
    expect(await readWalletBalance(watcher, tutorId)).toBe(before + 100);

    const awards = await readAwards();
    expect(awards).toHaveLength(1);
    expect(awards[0].month_start).toBe(NOV);
    expect(Number(awards[0].weekly_credits_deducted)).toBe(0);
    const ledger = await readBonusLedger();
    expect(ledger).toHaveLength(1);
    expect(Number(ledger[0].delta)).toBe(100);
    expect(awards[0].transaction_id).not.toBeNull();

    const again = await inTransaction(alpha, () => runAvailabilityBonus(availabilityBonusPort, SETTINGS, DEC_1));
    expect(again.awarded).toHaveLength(0);
    expect(await readWalletBalance(watcher, tutorId)).toBe(before + 100);
    expect(await readAwards()).toHaveLength(1);
    expect(await readBonusLedger()).toHaveLength(1);
  });

  it("takes weekly credits for weeks starting in November off, and ignores a week that started in October", async () => {
    await setNovemberHours(21);
    await insertWeeklyAward("2026-10-26", 40); // started in October: not deducted
    await insertWeeklyAward("2026-11-02", 40); // started in November: deducted
    const before = (await readWalletBalance(watcher, tutorId)) ?? 0;

    const r = await inTransaction(alpha, () => runAvailabilityBonus(availabilityBonusPort, SETTINGS, DEC_1));
    expect(r.awarded.map((a) => [a.credits, a.weeklyCreditsDeducted])).toEqual([[60, 40]]);
    expect(await readWalletBalance(watcher, tutorId)).toBe(before + 60);
    const [award] = await readAwards();
    expect([Number(award.credits), Number(award.weekly_credits_deducted)]).toEqual([60, 40]);
  });

  it("a zero-net month is settled with no ledger row", async () => {
    await setNovemberHours(25);
    await insertWeeklyAward("2026-11-02", 40);
    await insertWeeklyAward("2026-11-09", 40);
    await insertWeeklyAward("2026-11-16", 40);

    const r = await inTransaction(alpha, () => runAvailabilityBonus(availabilityBonusPort, SETTINGS, DEC_1));
    expect(r.awarded).toHaveLength(0);
    expect(r.settledZero).toBe(1);
    const [award] = await readAwards();
    expect([Number(award.credits), Number(award.weekly_credits_deducted), award.transaction_id]).toEqual([0, 100, null]);
    expect(await readBonusLedger()).toHaveLength(0);
  });

  it("the award unique index refuses a second award row for the same month, and the ledger stays at one", async () => {
    await setNovemberHours(20);
    await inTransaction(alpha, () => runAvailabilityBonus(availabilityBonusPort, SETTINGS, DEC_1));

    let credited = false;
    const out = await inTransaction(alpha, () =>
      availabilityBonusPort.claimAndCredit(
        { tutorId, monthStart: NOV, liveSeconds: 72_000, credits: 100, weeklyCreditsDeducted: 0 },
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

  it("October hours are never paid", async () => {
    await setDaySeconds("2026-10-10", 40 * 3600);
    const r = await inTransaction(alpha, () => runAvailabilityBonus(availabilityBonusPort, SETTINGS, DEC_1));
    expect(r.awarded).toHaveLength(0);
    expect(await readAwards()).toHaveLength(0);
  });

  it("under the threshold, unapproved or suspended: nothing", async () => {
    await setNovemberHours(20 - 1 / 3600);
    let r = await inTransaction(alpha, () => runAvailabilityBonus(availabilityBonusPort, SETTINGS, DEC_1));
    expect(r.awarded).toHaveLength(0);

    await setNovemberHours(22);
    await watcher.db.execute(sql`update tutor_profiles set approval_status = 'changes_requested' where user_id = ${tutorId}`);
    r = await inTransaction(alpha, () => runAvailabilityBonus(availabilityBonusPort, SETTINGS, DEC_1));
    expect(r.awarded).toHaveLength(0);

    await watcher.db.execute(sql`update tutor_profiles set approval_status = 'approved' where user_id = ${tutorId}`);
    await watcher.db.execute(sql`update profiles set is_suspended = true where id = ${tutorId}`);
    r = await inTransaction(alpha, () => runAvailabilityBonus(availabilityBonusPort, SETTINGS, DEC_1));
    expect(r.awarded).toHaveLength(0);

    expect(await readAwards()).toHaveLength(0);
    expect(await readBonusLedger()).toHaveLength(0);
  });
});
