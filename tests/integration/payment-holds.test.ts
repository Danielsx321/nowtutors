import type { SQL } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createFixtureBooking,
  deleteFixtureBooking,
  openConnection,
  type TestConnection,
} from "./helpers/test-db";

/**
 * `countOpenPaymentHolds` against a real Postgres (R3, launch fixes
 * 2026-09-26). Test project only.
 *
 * Counts this file's own fixtures relative to a baseline read first, never an
 * absolute number: the shared test project may hold other pending_payment
 * rows for the seeded student.
 */
type Executor = import("@/db").DbTransaction;

vi.mock("@/db", async () => {
  const { currentExecutor } = await import("./helpers/test-db");
  return {
    db: {
      execute: (query: SQL) => currentExecutor().execute(query),
      select: ((...args: Parameters<Executor["select"]>) =>
        currentExecutor().select(...args)) as Executor["select"],
    },
  };
});

const { countOpenPaymentHolds } = await import("@/db/queries/bookings");
const { withExecutor } = await import("./helpers/test-db");

let conn: TestConnection;
let created: string[] = [];

beforeAll(() => {
  conn = openConnection("payment-holds");
});

afterEach(async () => {
  for (const id of created) await deleteFixtureBooking(conn, id);
  created = [];
});

afterAll(async () => {
  await conn.end();
});

async function count(studentId: string) {
  return withExecutor(conn.db as unknown as Executor, () =>
    countOpenPaymentHolds(conn.db as unknown as Parameters<typeof countOpenPaymentHolds>[0], studentId, 20),
  );
}

describe("countOpenPaymentHolds", () => {
  it("counts fresh pending_payment scheduled holds and ignores expired, paid and instant rows", async () => {
    const probe = await createFixtureBooking(conn, { type: "scheduled", status: "pending_payment", scheduledEndMinutesAgo: -60 });
    created.push(probe.bookingId);
    const { studentId } = probe;
    const base = (await count(studentId)) - 1;

    const fresh = await createFixtureBooking(conn, { type: "scheduled", status: "pending_payment", scheduledEndMinutesAgo: -120, createdMinutesAgo: 5 });
    const stale = await createFixtureBooking(conn, { type: "scheduled", status: "pending_payment", scheduledEndMinutesAgo: -180, createdMinutesAgo: 25 });
    const paid = await createFixtureBooking(conn, { type: "scheduled", status: "confirmed", scheduledEndMinutesAgo: -240 });
    const instant = await createFixtureBooking(conn, { status: "in_progress" });
    created.push(fresh.bookingId, stale.bookingId, paid.bookingId, instant.bookingId);

    // probe (fresh) + fresh count; stale (older than the hold), paid and instant do not.
    expect(await count(studentId)).toBe(base + 2);
  });
});
