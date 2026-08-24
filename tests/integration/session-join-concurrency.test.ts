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
  toEpochMicros,
  waitUntilBlockedBy,
  withExecutor,
  type FixtureBooking,
  type HeldTransaction,
  type TestConnection,
} from "./helpers/test-db";

/**
 * `stampSessionJoin` against a real Postgres, with a real row-lock contest.
 *
 * **Why this cannot be a unit test.** `started_at` is the clock Part 3B's
 * elapsed-time hard stop is computed from (SPEC §4.3, §7.4), and the rule that
 * protects it — "written only on the statement that makes BOTH parties
 * present, once, and never moved again" — is expressed entirely in one SQL
 * `UPDATE`. Its correctness is a property of how Postgres re-evaluates a
 * blocked `UPDATE` under READ COMMITTED: the qualifiers and `SET` expressions
 * are re-run against the *updated* row once the lock clears. No fake, no
 * in-memory store and no mocked driver reproduces that, which is why the
 * DB-free unit lane could not cover this and why the property shipped with a
 * code-review-only verification (docs/DECISIONS.md, Phase 6 Part 3A item 3).
 *
 * **The shipped code is unmodified.** `stampSessionJoin` takes no executor
 * argument and imports the `@/db` singleton; rather than widen its signature
 * for a test, the module is mocked to forward to whichever transaction is
 * current for the async context. What runs below is the shipped statement,
 * byte for byte.
 *
 * The concurrent case is a genuine contest, not two awaited calls: connection A
 * stamps and holds its transaction open, connection B issues its stamp against
 * the same row and *blocks*, and Postgres itself is asked to confirm the block
 * (`pg_blocking_pids`) before anything is asserted. Awaiting one call and then
 * the other would pass against the CTE draft this test exists to rule out.
 */
vi.mock("@/db", async () => {
  const { currentExecutor } = await import("./helpers/test-db");
  return {
    db: {
      execute: (query: SQL) => currentExecutor().execute(query),
    },
  };
});

const { stampSessionJoin } = await import("@/db/queries/sessions");

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("stampSessionJoin — concurrency properties (test project)", () => {
  let connA: TestConnection;
  let connB: TestConnection;
  /** A third connection, so the lock can be observed without joining the fight. */
  let watcher: TestConnection;
  let fixture: FixtureBooking;
  let openTransactions: HeldTransaction[];

  beforeAll(() => {
    connA = openConnection("A");
    connB = openConnection("B");
    watcher = openConnection("watcher");
  });

  afterAll(async () => {
    await Promise.all([connA.end(), connB.end(), watcher.end()]);
  });

  beforeEach(async () => {
    openTransactions = [];
    fixture = await createFixtureBooking(watcher);
  });

  afterEach(async () => {
    // Unwind anything a failed assertion left open BEFORE deleting, or the
    // delete would block on a lock the test itself is still holding. Rolling
    // back an already-committed handle is a no-op.
    for (const held of openTransactions) {
      await held.rollback().catch(() => {});
    }
    await deleteFixtureBooking(watcher, fixture.bookingId);
  });

  /** Open a transaction the teardown is guaranteed to close. */
  async function begin(conn: TestConnection): Promise<HeldTransaction> {
    const held = await beginTransaction(conn);
    openTransactions.push(held);
    return held;
  }

  /** One stamp, in its own transaction, committed before returning. */
  async function stampAndCommit(conn: TestConnection, userId: string) {
    const held = await begin(conn);
    const result = await withExecutor(held.tx, () =>
      stampSessionJoin(fixture.bookingId, userId),
    );
    await held.commit();
    return result;
  }

  it("sequential both-party join: started_at is the SECOND stamp's moment, not the first's", async () => {
    const first = await stampAndCommit(connA, fixture.studentId);

    expect(first).not.toBeNull();
    expect(first!.studentJoinedAt).not.toBeNull();
    expect(first!.tutorJoinedAt).toBeNull();
    // The whole point of the both-parties rule: one participant alone in the
    // room does not start the billing clock.
    expect(first!.startedAt).toBeNull();

    // A real gap, so "the second stamp's moment" and "the first's" are
    // distinguishable values rather than the same millisecond. `now()` is the
    // transaction timestamp, so each stamp carries its own transaction's start.
    await delay(1_100);

    const second = await stampAndCommit(connB, fixture.tutorId);
    expect(second).not.toBeNull();
    expect(second!.startedAt).not.toBeNull();

    const row = await readJoinColumns(watcher, fixture.bookingId);
    expect(row.student_joined_at).not.toBeNull();
    expect(row.tutor_joined_at).not.toBeNull();
    expect(row.started_at).not.toBeNull();

    // started_at IS the second arrival, exactly — same transaction, same now().
    expect(toEpochMicros(row.started_at!)).toBe(
      toEpochMicros(row.tutor_joined_at!),
    );
    // ...and is strictly later than the first arrival, which is the assertion
    // that fails under first-arrival semantics (the build brief's version, and
    // a silent overcharge — DECISIONS.md, Phase 6 Part 3A item 2).
    expect(toEpochMicros(row.started_at!)).toBeGreaterThan(
      toEpochMicros(row.student_joined_at!),
    );
    // The first party's stamp was not disturbed by the second write.
    expect(toEpochMicros(row.student_joined_at!)).toBe(
      toEpochMicros(first!.studentJoinedAt!),
    );
  });

  it("concurrent join on two connections: started_at written exactly once, neither joined_at pushed back to null", async () => {
    const heldA = await begin(connA);
    const heldB = await begin(connB);

    // A stamps and holds the row lock. Nothing is committed yet.
    const resultA = await withExecutor(heldA.tx, () =>
      stampSessionJoin(fixture.bookingId, fixture.studentId),
    );
    expect(resultA).not.toBeNull();
    expect(resultA!.studentJoinedAt).not.toBeNull();
    expect(resultA!.startedAt).toBeNull();

    // B issues the same statement for the other party. It must block: its
    // snapshot predates A's uncommitted write.
    let settledEarly = false;
    const pendingB = withExecutor(heldB.tx, () =>
      stampSessionJoin(fixture.bookingId, fixture.tutorId),
    ).then((result) => {
      settledEarly = true;
      return result;
    });

    // Postgres confirms the contention, rather than a sleep implying it.
    await waitUntilBlockedBy(watcher, heldB.pid, heldA.pid);
    expect(settledEarly).toBe(false);

    // Release. B now re-evaluates its qualifiers and SET expressions against
    // the row A actually wrote — the behaviour a CTE would not get, because a
    // CTE is materialized from the original snapshot and is not re-read.
    await heldA.commit();
    const resultB = await pendingB;
    await heldB.commit();

    expect(resultB).not.toBeNull();

    // Written exactly once, and by the second statement: A's own returning row
    // still showed null, B's did not.
    expect(resultA!.startedAt).toBeNull();
    expect(resultB!.startedAt).not.toBeNull();

    const row = await readJoinColumns(watcher, fixture.bookingId);
    expect(row.started_at).not.toBeNull();
    expect(toEpochMicros(row.started_at!)).toBe(
      toEpochMicros(resultB!.startedAt!),
    );

    // THE assertion the CTE draft fails. B's write, computed from a stale
    // snapshot, would push student_joined_at back to null and erase the stamp A
    // had just made — leaving a session that is "started" with a participant
    // who, per the row, never arrived.
    expect(row.student_joined_at).not.toBeNull();
    expect(row.tutor_joined_at).not.toBeNull();
  });

  it("lone participant: started_at stays null while the other party never joins", async () => {
    const first = await stampAndCommit(connA, fixture.studentId);
    expect(first!.studentJoinedAt).not.toBeNull();
    expect(first!.startedAt).toBeNull();

    // A refresh, or Part 3B's token renewal, by the same lone party.
    await delay(1_100);
    const again = await stampAndCommit(connB, fixture.studentId);
    expect(again!.startedAt).toBeNull();
    expect(toEpochMicros(again!.studentJoinedAt!)).toBe(
      toEpochMicros(first!.studentJoinedAt!),
    );

    const row = await readJoinColumns(watcher, fixture.bookingId);
    expect(row.tutor_joined_at).toBeNull();
    // No clock, no billing. A student waiting alone for a tutor who never
    // arrives is not in a session (§7.4 has no refund and no grace period).
    expect(row.started_at).toBeNull();
  });

  it("idempotent after both joined: re-stamping either party moves nothing", async () => {
    await stampAndCommit(connA, fixture.studentId);
    await delay(1_100);
    await stampAndCommit(connB, fixture.tutorId);

    const before = await readJoinColumns(watcher, fixture.bookingId);
    expect(before.started_at).not.toBeNull();

    // Both of these happen for real: a browser refresh re-requests a token, and
    // Part 3B's renewal will re-run this write on a timer for the whole session.
    await delay(1_100);
    const studentRefresh = await stampAndCommit(connA, fixture.studentId);
    const tutorRefresh = await stampAndCommit(connB, fixture.tutorId);

    for (const result of [studentRefresh, tutorRefresh]) {
      expect(toEpochMicros(result!.startedAt!)).toBe(
        toEpochMicros(before.started_at!),
      );
      expect(toEpochMicros(result!.studentJoinedAt!)).toBe(
        toEpochMicros(before.student_joined_at!),
      );
      expect(toEpochMicros(result!.tutorJoinedAt!)).toBe(
        toEpochMicros(before.tutor_joined_at!),
      );
    }

    const after = await readJoinColumns(watcher, fixture.bookingId);
    expect(toEpochMicros(after.started_at!)).toBe(
      toEpochMicros(before.started_at!),
    );
    expect(toEpochMicros(after.student_joined_at!)).toBe(
      toEpochMicros(before.student_joined_at!),
    );
    expect(toEpochMicros(after.tutor_joined_at!)).toBe(
      toEpochMicros(before.tutor_joined_at!),
    );
    // Backfilled once and stable — a second channel value mid-session would put
    // the two participants in different rooms.
    expect(after.agora_channel).toBe(`session_${fixture.bookingId}`);
  });
});
