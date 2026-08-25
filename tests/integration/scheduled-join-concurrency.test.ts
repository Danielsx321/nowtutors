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
  readJoinColumns,
  readScheduledJoinColumns,
  epochMs,
  waitUntilBlockedBy,
  withExecutor,
  type FixtureBooking,
  type HeldTransaction,
  type TestConnection,
} from "./helpers/test-db";

/**
 * `stampScheduledSessionJoin` against a real Postgres (SPEC §7.7 steps 2 and 4).
 *
 * **Why this file exists at all.** The `started_at` rule is defined once, in
 * `db/queries/join-stamp.ts`, and imported by both join statements — the instant
 * one (`stampSessionJoin`, covered by `session-join-concurrency.test.ts`) and
 * the scheduled one covered here. A shared fragment is only genuinely shared if
 * breaking it fails tests on **both** sides; with coverage on one side only, the
 * scheduled path would be free to drift silently and the "one definition" claim
 * would be decoration. This file is the other half of that claim.
 *
 * It also covers what the scheduled statement adds on top of the shared rule and
 * the instant path has no equivalent of:
 *
 *  - `confirmed → in_progress`, on the same predicate that writes `started_at`,
 *    so the two cannot disagree about when a session began;
 *  - `lessonspace_room_id`, persisted once and never replaced;
 *  - `type = 'scheduled'` scoping, which makes this statement incapable of
 *    touching an instant booking.
 *
 * As in the instant lane, the concurrent case is a genuine row-lock contest
 * confirmed by Postgres (`pg_blocking_pids`), not two awaited calls — awaiting
 * one and then the other would pass against the CTE draft this shape rules out.
 */
vi.mock("@/db", async () => {
  const { currentExecutor } = await import("./helpers/test-db");
  return {
    db: {
      execute: (query: SQL) => currentExecutor().execute(query),
    },
  };
});

const { stampScheduledSessionJoin } = await import("@/db/queries/classroom");

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Stands in for what `spaces/launch/` returns. The statement only coalesces it. */
const ROOM_ID = "space-fixture-1";

describe("stampScheduledSessionJoin — concurrency properties (test project)", () => {
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
    await Promise.all(opened.splice(0).map((conn) => conn.end().catch(() => {})));
  });

  beforeEach(async () => {
    openTransactions = [];
    // A scheduled booking in the state `createScheduledBooking` leaves it:
    // `confirmed`, nobody joined, no `started_at`. A real window is given so the
    // row is what `bookings_no_overlap` expects of a scheduled booking.
    fixture = await createFixtureBooking(watcher, {
      type: "scheduled",
      status: "confirmed",
      durationMinutes: 60,
      scheduledEndMinutesAgo: 10,
    });
  });

  afterEach(async () => {
    for (const held of openTransactions) {
      await held.rollback().catch(() => {});
    }
    if (fixture) await deleteFixtureBooking(watcher, fixture.bookingId);
    fixture = undefined;
  });

  async function begin(conn: TestConnection): Promise<HeldTransaction> {
    const held = await beginTransaction(conn);
    openTransactions.push(held);
    return held;
  }

  /** One stamp, in its own transaction, committed before returning. */
  async function stampAndCommit(
    conn: TestConnection,
    userId: string,
    roomId = ROOM_ID,
  ) {
    const held = await begin(conn);
    const result = await withExecutor(held.tx, () =>
      stampScheduledSessionJoin(fixture!.bookingId, userId, roomId),
    );
    await held.commit();
    return result;
  }

  it("sequential both-party join: started_at is the SECOND stamp's moment, and status flips with it", async () => {
    const first = await stampAndCommit(connA, fixture!.studentId);

    expect(first).not.toBeNull();
    expect(first!.studentJoinedAt).not.toBeNull();
    expect(first!.tutorJoinedAt).toBeNull();
    // One participant alone in the classroom does not start the clock...
    expect(first!.startedAt).toBeNull();
    // ...and does not advance the booking. A tutor who never arrives must leave
    // this booking classifiable as a no-show, not as a session that ran.
    expect(first!.status).toBe("confirmed");
    // Step 2: the room id is persisted on the very first join.
    expect(first!.lessonspaceRoomId).toBe(ROOM_ID);

    // A real gap, so "the second stamp's moment" and "the first's" are
    // distinguishable values rather than the same millisecond.
    await delay(1_100);

    const second = await stampAndCommit(connB, fixture!.tutorId);
    expect(second).not.toBeNull();
    expect(second!.startedAt).not.toBeNull();
    expect(second!.status).toBe("in_progress");

    // The shape itself, asserted rather than assumed: `toDate` at the raw-query
    // boundary is what makes these `Date`s, and the completion cron reads them.
    expect(second!.startedAt).toBeInstanceOf(Date);
    expect(second!.studentJoinedAt).toBeInstanceOf(Date);
    expect(second!.tutorJoinedAt).toBeInstanceOf(Date);

    const row = await readScheduledJoinColumns(watcher, fixture!.bookingId);
    expect(row.studentJoinedAt).not.toBeNull();
    expect(row.tutorJoinedAt).not.toBeNull();
    expect(row.status).toBe("in_progress");

    // started_at IS the second arrival, exactly — same transaction, same now().
    expect(epochMs(row.startedAt!)).toBe(epochMs(row.tutorJoinedAt!));
    // ...and strictly later than the first arrival. This is the assertion that
    // fails under first-arrival semantics — the shared fragment's whole point.
    expect(epochMs(row.startedAt!)).toBeGreaterThan(
      epochMs(row.studentJoinedAt!),
    );
    // The first party's stamp was not disturbed by the second write.
    expect(epochMs(row.studentJoinedAt!)).toBe(epochMs(first!.studentJoinedAt!));
  });

  it("concurrent join on two connections: started_at written exactly once, neither joined_at pushed back to null", async () => {
    const heldA = await begin(connA);
    const heldB = await begin(connB);

    // A stamps and holds the row lock. Nothing is committed yet.
    const resultA = await withExecutor(heldA.tx, () =>
      stampScheduledSessionJoin(fixture!.bookingId, fixture!.studentId, ROOM_ID),
    );
    expect(resultA).not.toBeNull();
    expect(resultA!.studentJoinedAt).not.toBeNull();
    expect(resultA!.startedAt).toBeNull();
    expect(resultA!.status).toBe("confirmed");

    // B issues the same statement for the other party. It must block: its
    // snapshot predates A's uncommitted write.
    let settledEarly = false;
    const pendingB = withExecutor(heldB.tx, () =>
      stampScheduledSessionJoin(fixture!.bookingId, fixture!.tutorId, ROOM_ID),
    ).then((result) => {
      settledEarly = true;
      return result;
    });

    // Postgres confirms the contention, rather than a sleep implying it.
    await waitUntilBlockedBy(watcher, heldB.pid, heldA.pid);
    expect(settledEarly).toBe(false);

    // Release. B now re-evaluates its qualifiers and SET expressions against the
    // row A actually wrote — the behaviour a CTE would not get, because a CTE is
    // materialized from the original snapshot and is not re-read.
    await heldA.commit();
    const resultB = await pendingB;
    await heldB.commit();

    expect(resultB).not.toBeNull();

    // Written exactly once, and by the second statement.
    expect(resultA!.startedAt).toBeNull();
    expect(resultB!.startedAt).not.toBeNull();
    expect(resultB!.status).toBe("in_progress");

    const row = await readScheduledJoinColumns(watcher, fixture!.bookingId);
    expect(epochMs(row.startedAt!)).toBe(epochMs(resultB!.startedAt!));

    // THE assertion the CTE draft fails: B's write, computed from a stale
    // snapshot, would push student_joined_at back to null and erase the stamp A
    // had just made — a session that is "started" and `in_progress` with a
    // participant who, per the row, never arrived.
    expect(row.studentJoinedAt).not.toBeNull();
    expect(row.tutorJoinedAt).not.toBeNull();
    expect(row.status).toBe("in_progress");
  });

  it("lone participant: started_at stays null and the booking stays confirmed", async () => {
    const first = await stampAndCommit(connA, fixture!.studentId);
    expect(first!.studentJoinedAt).not.toBeNull();
    expect(first!.startedAt).toBeNull();

    // A refresh, or a second tab, by the same lone party.
    await delay(1_100);
    const again = await stampAndCommit(connB, fixture!.studentId);
    expect(again!.startedAt).toBeNull();
    expect(again!.status).toBe("confirmed");
    expect(epochMs(again!.studentJoinedAt!)).toBe(
      epochMs(first!.studentJoinedAt!),
    );

    const row = await readScheduledJoinColumns(watcher, fixture!.bookingId);
    expect(row.tutorJoinedAt).toBeNull();
    expect(row.startedAt).toBeNull();
    expect(row.status).toBe("confirmed");
  });

  it("idempotent after both joined: re-stamping moves nothing, and the room id is never replaced", async () => {
    await stampAndCommit(connA, fixture!.studentId);
    await delay(1_100);
    await stampAndCommit(connB, fixture!.tutorId);

    const before = await readScheduledJoinColumns(watcher, fixture!.bookingId);
    expect(before.startedAt).not.toBeNull();
    expect(before.status).toBe("in_progress");

    // A refresh re-requests a link, and every request re-runs this write.
    // The second launch is passed a DIFFERENT room id on purpose: LessonSpace is
    // idempotent on the booking id so this cannot happen in practice, but if it
    // ever did, replacing the id mid-session would put the two participants in
    // different rooms.
    await delay(1_100);
    const studentRefresh = await stampAndCommit(
      connA,
      fixture!.studentId,
      "space-fixture-DIFFERENT",
    );
    const tutorRefresh = await stampAndCommit(connB, fixture!.tutorId);

    for (const result of [studentRefresh, tutorRefresh]) {
      expect(epochMs(result!.startedAt!)).toBe(epochMs(before.startedAt!));
      expect(epochMs(result!.studentJoinedAt!)).toBe(
        epochMs(before.studentJoinedAt!),
      );
      expect(epochMs(result!.tutorJoinedAt!)).toBe(
        epochMs(before.tutorJoinedAt!),
      );
      expect(result!.lessonspaceRoomId).toBe(ROOM_ID);
      expect(result!.status).toBe("in_progress");
    }

    const after = await readScheduledJoinColumns(watcher, fixture!.bookingId);
    expect(epochMs(after.startedAt!)).toBe(epochMs(before.startedAt!));
    expect(after.lessonspaceRoomId).toBe(ROOM_ID);
  });

  it("refuses a non-participant, and says nothing different about why", async () => {
    // The tutor's own id is a participant; a third profile is not. Reusing the
    // booking id with a foreign user must match zero rows.
    const stranger = "00000000-0000-4000-8000-000000000000";
    const result = await stampAndCommit(connA, stranger);
    expect(result).toBeNull();

    const row = await readScheduledJoinColumns(watcher, fixture!.bookingId);
    expect(row.studentJoinedAt).toBeNull();
    expect(row.tutorJoinedAt).toBeNull();
    expect(row.lessonspaceRoomId).toBeNull();
    expect(row.status).toBe("confirmed");
  });
});

/**
 * The `type = 'scheduled'` scoping, as a property rather than a convention.
 *
 * The two join statements must have **disjoint row sets by construction**, not
 * by caller discipline: this one is incapable of writing to an instant booking
 * even when handed its id. Without the guard, a miscall would stamp an instant
 * row and write a `lessonspace_room_id` onto a booking whose room is Agora.
 */
describe("stampScheduledSessionJoin — cannot touch an instant booking", () => {
  let conn: TestConnection;
  let fixture: FixtureBooking | undefined;

  beforeAll(() => {
    conn = openConnection("scoping");
  });

  afterAll(async () => {
    await conn?.end().catch(() => {});
  });

  beforeEach(async () => {
    // The instant path's own fixture: in_progress, as the accept transaction
    // leaves it, and therefore passing every part of the scheduled statement's
    // WHERE except the type guard.
    fixture = await createFixtureBooking(conn, { type: "instant" });
  });

  afterEach(async () => {
    if (fixture) await deleteFixtureBooking(conn, fixture.bookingId);
    fixture = undefined;
  });

  it("matches zero rows for an instant booking and writes nothing", async () => {
    const held = await beginTransaction(conn);
    const result = await withExecutor(held.tx, () =>
      stampScheduledSessionJoin(fixture!.bookingId, fixture!.studentId, ROOM_ID),
    );
    await held.commit();

    expect(result).toBeNull();

    const row = await readScheduledJoinColumns(conn, fixture!.bookingId);
    expect(row.studentJoinedAt).toBeNull();
    expect(row.startedAt).toBeNull();
    // The column that would be actively wrong: an instant booking's room is the
    // Agora channel, and it must never acquire a LessonSpace id.
    expect(row.lessonspaceRoomId).toBeNull();
    expect(row.status).toBe("in_progress");

    // And the instant path's own columns are untouched.
    const joinRow = await readJoinColumns(conn, fixture!.bookingId);
    expect(joinRow.agoraChannel).toBeNull();
  });
});
