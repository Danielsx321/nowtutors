import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  beginTransaction,
  createFixtureBooking,
  deleteFixtureBooking,
  openConnection,
  withExecutor,
  type TestConnection,
} from "./helpers/test-db";

/**
 * `expire-unpaid` against a real Postgres (SPEC §4.2, §12; Phase 8 Part 3).
 * Test project only.
 *
 * Asserts on this file's own fixture ids, never on the total count: the shared
 * test project may hold other `pending_payment` rows, and a test that expected
 * `expired: 2` would fail for data it did not create.
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

const { expireUnpaidBookings } = await import("@/db/queries/expire-unpaid");

let conn: TestConnection;
let watcher: TestConnection;
let created: string[] = [];

beforeAll(() => {
  conn = openConnection("expire-unpaid");
  watcher = openConnection("watcher");
});

afterEach(async () => {
  for (const id of created) await deleteFixtureBooking(conn, id);
  created = [];
});

afterAll(async () => {
  await Promise.all([conn.end(), watcher.end()]);
});

async function booking(
  status: "pending_payment" | "confirmed",
  createdMinutesAgo: number,
): Promise<string> {
  const b = await createFixtureBooking(conn, { status, createdMinutesAgo });
  created.push(b.bookingId);
  return b.bookingId;
}

async function sweep() {
  const held = await beginTransaction(conn);
  try {
    const result = await withExecutor(held.tx, () => expireUnpaidBookings());
    await held.commit();
    return result;
  } catch (err) {
    await held.rollback();
    throw err;
  }
}

async function statusOf(id: string): Promise<string> {
  const [row] = await watcher.db.execute<{ status: string }>(
    sql`select status::text from bookings where id = ${id}`,
  );
  return row.status;
}

describe("expireUnpaidBookings", () => {
  it("expires a checkout past 20 minutes and leaves a live one", async () => {
    const stale = await booking("pending_payment", 21);
    const live = await booking("pending_payment", 19);

    const { expiredIds } = await sweep();

    expect(expiredIds).toContain(stale);
    expect(expiredIds).not.toContain(live);
    expect(await statusOf(stale)).toBe("expired");
    expect(await statusOf(live)).toBe("pending_payment");
  });

  it("never touches a booking that is not pending_payment, however old", async () => {
    const paid = await booking("confirmed", 600);
    const { expiredIds } = await sweep();
    expect(expiredIds).not.toContain(paid);
    expect(await statusOf(paid)).toBe("confirmed");
  });

  it("is idempotent: a second run does not report the same row again", async () => {
    const stale = await booking("pending_payment", 45);
    expect((await sweep()).expiredIds).toContain(stale);
    expect((await sweep()).expiredIds).not.toContain(stale);
    expect(await statusOf(stale)).toBe("expired");
  });
});
