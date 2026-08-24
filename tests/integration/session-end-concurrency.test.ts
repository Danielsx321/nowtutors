import type { SQL } from "drizzle-orm";
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
  deleteFixtureBooking,
  openConnection,
  readEndColumns,
  readTiming,
  sqlSaysElapsed,
  waitUntilBlockedBy,
  withExecutor,
  type FixtureBooking,
  type HeldTransaction,
  type TestConnection,
} from "./helpers/test-db";
import { hasElapsed } from "@/lib/sessions/deadline";

/**
 * The end-session transition against a real Postgres, with a real row-lock
 * contest (SPEC §7.4, §15).
 *
 * **Why this cannot be a unit test.** "Exactly one transition" is not a property
 * of the TypeScript around the statement — it is a property of how Postgres
 * re-evaluates a blocked `UPDATE` under READ COMMITTED: the qualifiers are re-run
 * against the *updated* row once the lock clears, so the second writer sees
 * `status = 'completed'` and matches zero rows. No fake, no in-memory store and
 * no mocked driver reproduces that. It is the same argument §15 already makes
 * for `stampSessionJoin`, and the same mechanism.
 *
 * **It is money-adjacent.** A booking that transitions twice re-stamps
 * `ended_at`, and Part 3C derives `tutor_earnings.available_at` from `ended_at`
 * (§7.11) — so a lost race here moves when a tutor can withdraw. A booking that
 * transitions when it never started would have Part 3C pay a tutor who was never
 * in the room, against a student §7.4 forbids refunding.
 *
 * **The shipped code is unmodified.** The query functions import the `@/db`
 * singleton and take no executor argument; rather than widen a shipped signature
 * for a test, the module is mocked to forward to whichever transaction is
 * current for the async context. What runs below is the shipped statement.
 *
 * The concurrent cases are genuine contests, not two awaited calls: connection A
 * writes and holds its transaction open, connection B issues its write against
 * the same row and *blocks*, and Postgres itself is asked to confirm the block
 * (`pg_blocking_pids`) before anything is asserted. Awaiting one and then the
 * other would pass against a read-then-write implementation, which is exactly
 * what these tests exist to rule out.
 */
type Executor = import("@/db").DbTransaction;

vi.mock("@/db", async () => {
  const { currentExecutor } = await import("./helpers/test-db");
  return {
    db: {
      execute: (query: SQL) => currentExecutor().execute(query),
      // The transition is written through the query builder (so `.returning()`
      // decodes real `Date`s), so the mock forwards `update` as well — the join
      // lane's mock needed only `execute`. Nothing else is forwarded: the
      // helpers read through their own connections on purpose, so a read that
      // verifies a write is never decoded by the same path that made it.
      update: ((table: Parameters<Executor["update"]>[0]) =>
        currentExecutor().update(table)) as Executor["update"],
    },
  };
});

const { endElapsedInstantSession, endInstantSessionByParticipant } = await import(
  "@/db/queries/sessions"
);

describe("end-session transition — concurrency properties (test project)", () => {
  let connA: TestConnection;
  let connB: TestConnection;
  /** A third connection, so the lock can be observed without joining the fight. */
  let watcher: TestConnection;
  let fixture: FixtureBooking | undefined;
  let openTransactions: HeldTransaction[] = [];
  const opened: TestConnection[] = [];

  function open(label: string): TestConnection {
    const conn = openConnection(label);
    opened.push(conn);
    return conn;
  }

  beforeAll(() => {
    connA = open("A");
    connB = open("B");
    watcher = open("watcher");
  });

  afterAll(async () => {
    await Promise.all(opened.map((conn) => conn.end()));
  });

  beforeEach(() => {
    openTransactions = [];
  });

  afterEach(async () => {
    // Unwind anything a failing assertion left open BEFORE deleting the row,
    // or the delete blocks on a lock the test itself is still holding.
    for (const held of openTransactions.reverse()) {
      await held.rollback().catch(() => undefined);
    }
    if (fixture) {
      await deleteFixtureBooking(watcher, fixture.bookingId);
      fixture = undefined;
    }
  });

  async function begin(conn: TestConnection): Promise<HeldTransaction> {
    const held = await beginTransaction(conn);
    openTransactions.push(held);
    return held;
  }

  it("two participants ending at the same instant transition exactly once", async () => {
    // Ten minutes into a thirty-minute session: live, so neither call is the
    // deadline path — this is purely two people clicking End together.
    fixture = await createFixtureBooking(watcher, {
      startedMinutesAgo: 10,
      durationMinutes: 30,
    });
    const { bookingId, studentId, tutorId } = fixture;

    const a = await begin(connA);
    const b = await begin(connB);

    // A writes and holds the row lock.
    const first = await withExecutor(a.tx, () =>
      endInstantSessionByParticipant(bookingId, studentId),
    );
    expect(first).not.toBeNull();

    // B issues its write and must BLOCK on A's lock rather than proceeding.
    let secondSettled = false;
    const second = withExecutor(b.tx, () =>
      endInstantSessionByParticipant(bookingId, tutorId),
    ).then((row) => {
      secondSettled = true;
      return row;
    });

    await waitUntilBlockedBy(watcher, b.pid, a.pid);
    expect(secondSettled).toBe(false);

    await a.commit();
    const secondResult = await second;

    // The whole property: B re-evaluated against the committed row, saw
    // `completed`, and matched nothing.
    expect(secondResult).toBeNull();
    await b.commit();

    const row = await readEndColumns(watcher, bookingId);
    expect(row.status).toBe("completed");
    expect(row.endedAt).not.toBeNull();
    expect(row.billedMinutes).toBe(30);
    // A's returned value is the one that stands, and it agrees with the row.
    expect(row.endedAt?.getTime()).toBe(first!.endedAt?.getTime());
  });

  it("an early end racing the deadline transitions exactly once", async () => {
    // Sitting exactly on the boundary, so both paths qualify at the same moment.
    fixture = await createFixtureBooking(watcher, {
      startedMinutesAgo: 30,
      durationMinutes: 30,
    });
    const { bookingId, studentId } = fixture;

    const a = await begin(connA);
    const b = await begin(connB);

    const viaDeadline = await withExecutor(a.tx, () =>
      endElapsedInstantSession(bookingId),
    );
    expect(viaDeadline).not.toBeNull();

    let secondSettled = false;
    const viaParticipant = withExecutor(b.tx, () =>
      endInstantSessionByParticipant(bookingId, studentId),
    ).then((row) => {
      secondSettled = true;
      return row;
    });

    await waitUntilBlockedBy(watcher, b.pid, a.pid);
    expect(secondSettled).toBe(false);

    await a.commit();
    expect(await viaParticipant).toBeNull();
    await b.commit();

    const row = await readEndColumns(watcher, bookingId);
    expect(row.status).toBe("completed");
  });

  it("re-running the transition afterwards moves nothing", async () => {
    fixture = await createFixtureBooking(watcher, {
      startedMinutesAgo: 10,
      durationMinutes: 30,
    });
    const { bookingId, studentId, tutorId } = fixture;

    const a = await begin(connA);
    const ended = await withExecutor(a.tx, () =>
      endInstantSessionByParticipant(bookingId, studentId),
    );
    await a.commit();
    expect(ended).not.toBeNull();

    const afterFirst = await readEndColumns(watcher, bookingId);

    // Every later caller: the other party, a retry, and the deadline path that
    // Part 3C's cron will use.
    const b = await begin(connB);
    const again = await withExecutor(b.tx, () =>
      endInstantSessionByParticipant(bookingId, studentId),
    );
    const byOther = await withExecutor(b.tx, () =>
      endInstantSessionByParticipant(bookingId, tutorId),
    );
    const byDeadline = await withExecutor(b.tx, () =>
      endElapsedInstantSession(bookingId),
    );
    await b.commit();

    expect(again).toBeNull();
    expect(byOther).toBeNull();
    expect(byDeadline).toBeNull();

    const afterAll_ = await readEndColumns(watcher, bookingId);
    // `ended_at` is what Part 3C's `available_at` is derived from. If a repeat
    // call re-stamped it, every retry would push a tutor's withdrawal later.
    expect(afterAll_.endedAt?.getTime()).toBe(afterFirst.endedAt?.getTime());
    expect(afterAll_.status).toBe("completed");
  });

  it("caps ended_at at the deadline, so a late close records the true end", async () => {
    // The deadline passed twenty minutes ago and nobody closed the row — the
    // both-parties-offline case Part 3C's cron picks up.
    fixture = await createFixtureBooking(watcher, {
      startedMinutesAgo: 50,
      durationMinutes: 30,
    });
    const { bookingId } = fixture;

    const a = await begin(connA);
    const ended = await withExecutor(a.tx, () => endElapsedInstantSession(bookingId));
    await a.commit();

    expect(ended).not.toBeNull();
    const row = await readEndColumns(watcher, bookingId);
    const startedAt = row.startedAt!.getTime();
    const expected = startedAt + 30 * 60_000;

    // Within a second of started_at + duration, NOT of now() — which is twenty
    // minutes later. This is the property Part 3C silently depends on: a cron
    // running late must write the same `ended_at` the deadline actor would have.
    expect(Math.abs(row.endedAt!.getTime() - expected)).toBeLessThan(1000);
    expect(row.endedAt!.getTime()).toBeLessThan(Date.now() - 15 * 60_000);
  });

  it("caps a participant's late end identically to the deadline path", async () => {
    // Same row shape, closed by a person instead of by the sweep. The record
    // must not depend on which actor noticed.
    const viaDeadline = await createFixtureBooking(watcher, {
      startedMinutesAgo: 50,
      durationMinutes: 30,
    });
    const viaParticipant = await createFixtureBooking(watcher, {
      startedMinutesAgo: 50,
      durationMinutes: 30,
    });

    try {
      const a = await begin(connA);
      const byCron = await withExecutor(a.tx, () =>
        endElapsedInstantSession(viaDeadline.bookingId),
      );
      const byPerson = await withExecutor(a.tx, () =>
        endInstantSessionByParticipant(
          viaParticipant.bookingId,
          viaParticipant.studentId,
        ),
      );
      await a.commit();

      const cronRow = await readEndColumns(watcher, viaDeadline.bookingId);
      const personRow = await readEndColumns(watcher, viaParticipant.bookingId);

      const cronOffset = cronRow.endedAt!.getTime() - cronRow.startedAt!.getTime();
      const personOffset =
        personRow.endedAt!.getTime() - personRow.startedAt!.getTime();

      expect(byCron).not.toBeNull();
      expect(byPerson).not.toBeNull();
      // Both land at started_at + 30 minutes, whoever closed them.
      expect(Math.abs(cronOffset - 30 * 60_000)).toBeLessThan(1000);
      expect(Math.abs(personOffset - 30 * 60_000)).toBeLessThan(1000);
    } finally {
      await deleteFixtureBooking(watcher, viaDeadline.bookingId);
      await deleteFixtureBooking(watcher, viaParticipant.bookingId);
    }
  });

  it("uses now() for a genuine early exit rather than the deadline", async () => {
    fixture = await createFixtureBooking(watcher, {
      startedMinutesAgo: 5,
      durationMinutes: 60,
    });
    const { bookingId, tutorId } = fixture;

    const a = await begin(connA);
    await withExecutor(a.tx, () => endInstantSessionByParticipant(bookingId, tutorId));
    await a.commit();

    const row = await readEndColumns(watcher, bookingId);
    const elapsedMinutes =
      (row.endedAt!.getTime() - row.startedAt!.getTime()) / 60_000;
    // Five minutes in, not sixty: the cap must not drag an early exit forward
    // to a deadline that has not happened.
    expect(elapsedMinutes).toBeGreaterThan(4);
    expect(elapsedMinutes).toBeLessThan(6);
    // …and the student is still billed for all sixty (§7.4, no proration).
    expect(row.billedMinutes).toBe(60);
  });

  it("never transitions a session that never started", async () => {
    // No `started_at`: the pair never completed. Part 3C classifies these as
    // no-shows from `*_joined_at`; completing one here would have it pay a tutor
    // who was never in the room.
    fixture = await createFixtureBooking(watcher, { durationMinutes: 30 });
    const { bookingId, studentId } = fixture;

    const a = await begin(connA);
    const byPerson = await withExecutor(a.tx, () =>
      endInstantSessionByParticipant(bookingId, studentId),
    );
    const byDeadline = await withExecutor(a.tx, () =>
      endElapsedInstantSession(bookingId),
    );
    await a.commit();

    expect(byPerson).toBeNull();
    expect(byDeadline).toBeNull();

    const row = await readEndColumns(watcher, bookingId);
    expect(row.status).toBe("in_progress");
    expect(row.endedAt).toBeNull();
  });

  it("refuses a non-participant, and says nothing different about why", async () => {
    fixture = await createFixtureBooking(watcher, {
      startedMinutesAgo: 10,
      durationMinutes: 30,
    });
    const { bookingId } = fixture;

    const a = await begin(connA);
    const byStranger = await withExecutor(a.tx, () =>
      endInstantSessionByParticipant(bookingId, "00000000-0000-4000-8000-000000000000"),
    );
    await a.commit();

    // Null — the same value a booking that does not exist returns, which is what
    // lets the action answer both with the identical 404.
    expect(byStranger).toBeNull();
    expect((await readEndColumns(watcher, bookingId)).status).toBe("in_progress");
  });

  it("the deadline path will not fire before the deadline", async () => {
    fixture = await createFixtureBooking(watcher, {
      startedMinutesAgo: 29,
      durationMinutes: 30,
    });
    const { bookingId } = fixture;

    const a = await begin(connA);
    const early = await withExecutor(a.tx, () => endElapsedInstantSession(bookingId));
    await a.commit();

    // One minute to go. This is what makes a fast browser clock harmless: the
    // comparison is Postgres's, and it simply matches nothing.
    expect(early).toBeNull();
    expect((await readEndColumns(watcher, bookingId)).status).toBe("in_progress");
  });
});

/**
 * The contract between the two halves of the deadline pair.
 *
 * `lib/sessions/deadline.ts` computes the deadline in TypeScript for display and
 * for deciding whether to *attempt* a transition; `sessionElapsedSql` decides
 * authoritatively inside the statement. They are separate artefacts by necessity,
 * so something has to hold them to the same answer — particularly at the
 * boundary, where an inclusive/exclusive disagreement would be invisible except
 * for one millisecond in production.
 */
describe("deadline pair — SQL and TypeScript agree at the boundary", () => {
  let conn: TestConnection;
  const created: string[] = [];

  beforeAll(() => {
    conn = openConnection("boundary");
  });

  afterAll(async () => {
    for (const id of created) {
      await deleteFixtureBooking(conn, id).catch(() => undefined);
    }
    await conn.end();
  });

  async function seed(
    startedMinutesAgo: number | undefined,
    durationMinutes: number,
  ) {
    const fixture = await createFixtureBooking(conn, {
      startedMinutesAgo,
      durationMinutes,
    });
    created.push(fixture.bookingId);
    return fixture.bookingId;
  }

  it("agrees one minute BEFORE the deadline", async () => {
    const id = await seed(29, 30);
    const timing = await readTiming(conn, id);
    expect(await sqlSaysElapsed(conn, id)).toBe(false);
    expect(hasElapsed(timing, new Date())).toBe(false);
  });

  it("agrees one minute AFTER the deadline", async () => {
    const id = await seed(31, 30);
    const timing = await readTiming(conn, id);
    expect(await sqlSaysElapsed(conn, id)).toBe(true);
    expect(hasElapsed(timing, new Date())).toBe(true);
  });

  it("agrees AT the deadline — both inclusive", async () => {
    // The one that would drift. SQL is `<=`; `hasElapsed` is `>=`. A row seeded
    // exactly `duration` minutes ago is elapsed by both, and the few
    // milliseconds between the seed and the read only push it further past.
    const id = await seed(30, 30);
    const timing = await readTiming(conn, id);
    expect(await sqlSaysElapsed(conn, id)).toBe(true);
    expect(hasElapsed(timing, new Date())).toBe(true);
  });

  it("agrees that a session which never started has not elapsed", async () => {
    const id = await seed(undefined, 30);
    const timing = await readTiming(conn, id);
    expect(await sqlSaysElapsed(conn, id)).toBe(false);
    expect(hasElapsed(timing, new Date())).toBe(false);
  });
});
