import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  beginTransaction,
  createFixtureBooking,
  deleteFixtureBooking,
  openConnection,
  waitUntilBlockedBy,
  withExecutor,
  type TestConnection,
} from "./helpers/test-db";

/**
 * The booking-reminders claim against a real Postgres (SPEC §12; Phase 10
 * Part 3). Same reasoning as `release-earnings.test.ts`: "a booking is
 * reminded once" is a property of how Postgres re-evaluates a blocked
 * `UPDATE ... WHERE reminder_1h_sent_at IS NULL`, which no fake reproduces.
 * Connection A claims and holds its transaction; B's claim must block, then
 * match nothing once A commits.
 */
type Executor = import("@/db").DbTransaction;

vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => {
  const { currentExecutor } = await import("./helpers/test-db");
  return {
    db: {
      execute: (query: SQL) => currentExecutor().execute(query),
      select: ((...args: Parameters<Executor["select"]>) => currentExecutor().select(...args)) as Executor["select"],
      update: ((table: Parameters<Executor["update"]>[0]) => currentExecutor().update(table)) as Executor["update"],
    },
  };
});

const { claimDueReminders } = await import("@/db/queries/booking-reminders");
const { REMINDER_WINDOWS } = await import("@/lib/bookings/booking-reminders");

let alpha: TestConnection;
let beta: TestConnection;
let watcher: TestConnection;
const created: string[] = [];

beforeAll(() => {
  alpha = openConnection("alpha");
  beta = openConnection("beta");
  watcher = openConnection("watcher");
});

afterEach(async () => {
  while (created.length) await deleteFixtureBooking(alpha, created.pop()!);
});

afterAll(async () => {
  await Promise.all([alpha.end(), beta.end(), watcher.end()]);
});

/**
 * A confirmed scheduled booking starting `startsInMinutes` from the
 * database's now, booked `bookedMinutesAgo` ago. The fixture takes the end
 * offset, so a future end is a negative "minutes ago".
 */
async function scheduled(startsInMinutes: number, bookedMinutesAgo: number, durationMinutes = 30) {
  const b = await createFixtureBooking(alpha, {
    type: "scheduled",
    status: "confirmed",
    durationMinutes,
    scheduledEndMinutesAgo: -(startsInMinutes + durationMinutes),
    createdMinutesAgo: bookedMinutesAgo,
  });
  created.push(b.bookingId);
  return b.bookingId;
}

async function stamps(id: string) {
  const rows = await watcher.db.execute<{ r24: Date | null; r1: Date | null }>(
    sql`select reminder_24h_sent_at as r24, reminder_1h_sent_at as r1 from bookings where id = ${id}`,
  );
  return rows[0];
}

/** The database's clock, so the windows are measured the way the fixture was written. */
async function dbNow(): Promise<Date> {
  const rows = await watcher.db.execute<{ now: Date }>(sql`select now() as now`);
  return new Date(rows[0].now);
}

describe("claimDueReminders on the test project", () => {
  it("claims a session 45 minutes out for 1h, once, and stamps it", async () => {
    const id = await scheduled(45, 24 * 60);
    const now = await dbNow();

    const held = await beginTransaction(alpha);
    const first = await withExecutor(held.tx, () => claimDueReminders("1h", now, REMINDER_WINDOWS["1h"]));
    await held.commit();
    expect(first).toContain(id);
    expect((await stamps(id)).r1).not.toBeNull();

    const again = await beginTransaction(alpha);
    const second = await withExecutor(again.tx, () => claimDueReminders("1h", now, REMINDER_WINDOWS["1h"]));
    await again.commit();
    expect(second).not.toContain(id);
  });

  it("leaves alone a session booked ten minutes ago and one too far out", async () => {
    const fresh = await scheduled(45, 10);
    const later = await scheduled(3 * 60, 24 * 60);
    const now = await dbNow();

    const held = await beginTransaction(alpha);
    const claimed = await withExecutor(held.tx, () => claimDueReminders("1h", now, REMINDER_WINDOWS["1h"]));
    await held.rollback();
    expect(claimed).not.toContain(fresh);
    expect(claimed).not.toContain(later);
  });

  it("two overlapping runs: the second blocks, then claims nothing", async () => {
    const id = await scheduled(23 * 60, 2 * 24 * 60);
    const now = await dbNow();

    const a = await beginTransaction(alpha);
    const b = await beginTransaction(beta);

    const claimedByA = await withExecutor(a.tx, () => claimDueReminders("24h", now, REMINDER_WINDOWS["24h"]));
    expect(claimedByA).toContain(id);

    let bSettled = false;
    const claimedByB = withExecutor(b.tx, () => claimDueReminders("24h", now, REMINDER_WINDOWS["24h"])).then((v) => {
      bSettled = true;
      return v;
    });

    await waitUntilBlockedBy(watcher, b.pid, a.pid);
    expect(bSettled).toBe(false);

    await a.commit();
    expect(await claimedByB).not.toContain(id);
    await b.commit();

    expect((await stamps(id)).r24).not.toBeNull();
  });
});
