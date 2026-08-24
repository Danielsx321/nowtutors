import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { eq, sql, type SQL } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { DbTransaction } from "@/db";
import * as schema from "@/db/schema";
import { assertTestProjectRef } from "@/db/load-env";
import { sessionPoolerUrl } from "@/db/session-url";

/**
 * Connection plumbing for the DB-backed lane. Test project only.
 *
 * Everything here exists to make ONE thing possible: running the shipped
 * `stampSessionJoin` on two independent Postgres backends, each inside its own
 * open transaction, so a genuine row-lock contest happens between them. A test
 * that awaits one call and then the other proves nothing about the race — the
 * second statement would never block, never re-evaluate, and would pass just as
 * happily against an implementation that is wrong.
 */

/**
 * The session-pooler URL from `.env.test`, guarded.
 *
 * **`sessionPoolerUrl()`, not `DATABASE_URL`.** `DATABASE_URL` is the :6543
 * transaction pooler (PgBouncer), which hands a server connection back to the
 * pool between statements — the exact opposite of what this lane needs, since
 * it holds a transaction open across several awaits while a second connection
 * blocks on the row it locked. Session mode (:5432) gives each client its own
 * backend for the life of the connection.
 *
 * The ref guard runs here as well as in `vitest.integration.config.ts`: that one
 * checks what is on disk, this one checks the string actually about to be
 * connected with. `mipnoxlhurdbaahmvhhx` also serves production and this lane
 * writes rows.
 */
export function testDatabaseUrl(): string {
  const url = sessionPoolerUrl();
  assertTestProjectRef(url);
  return url;
}

export interface TestConnection {
  /** Label for failure messages — which side of the race this is. */
  readonly label: string;
  readonly db: PostgresJsDatabase<typeof schema>;
  readonly client: postgres.Sql;
  end(): Promise<void>;
}

/**
 * One client, one backend (`max: 1`). Two of these are two real connections;
 * anything less and the "concurrent" test is a fiction.
 */
export function openConnection(label: string): TestConnection {
  const client = postgres(testDatabaseUrl(), { prepare: false, max: 1 });
  return {
    label,
    client,
    db: drizzle(client, { schema }),
    end: () => client.end({ timeout: 5 }),
  };
}

export interface HeldTransaction {
  readonly tx: DbTransaction;
  /** The backend pid, captured inside the transaction — see `blockingPids`. */
  readonly pid: number;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/** Thrown to unwind a held transaction into a ROLLBACK. Never escapes. */
class RollbackSignal extends Error {}

/**
 * Open a transaction and hand back control of when it ends.
 *
 * Drizzle's `transaction()` is callback-scoped — it commits when the callback
 * returns — which cannot express "hold this open while the other connection
 * tries to write the same row." So the callback parks on a promise this
 * function resolves from the outside, turning the scope into an explicit
 * `commit()` / `rollback()` pair.
 */
export async function beginTransaction(
  conn: TestConnection,
): Promise<HeldTransaction> {
  let release!: (signal: "commit" | "rollback") => void;
  let ready!: (held: { tx: DbTransaction; pid: number }) => void;
  let failed!: (error: unknown) => void;

  const started = new Promise<{ tx: DbTransaction; pid: number }>(
    (resolve, reject) => {
      ready = resolve;
      failed = reject;
    },
  );

  const settled = conn.db
    .transaction(async (tx) => {
      // First statement in the transaction, so the pid is unambiguously the
      // backend this transaction's locks belong to.
      const rows = await tx.execute<{ pid: number }>(
        sql`select pg_backend_pid() as pid`,
      );
      ready({ tx, pid: Number(rows[0].pid) });
      const signal = await new Promise<"commit" | "rollback">((resolve) => {
        release = resolve;
      });
      if (signal === "rollback") throw new RollbackSignal();
    })
    .catch((error: unknown) => {
      if (error instanceof RollbackSignal) return;
      failed(error);
      throw error;
    });

  const { tx, pid } = await started;

  return {
    tx,
    pid,
    commit: async () => {
      release("commit");
      await settled;
    },
    rollback: async () => {
      release("rollback");
      await settled;
    },
  };
}

/**
 * The transaction the shipped code should run against, for the current async
 * context.
 *
 * `db/queries/sessions.ts` imports the `@/db` singleton and `stampSessionJoin`
 * takes no executor argument — and **that shipped signature is not being
 * changed to accommodate a test**. So the test mocks `@/db` with an object that
 * forwards to whichever transaction is current, and `AsyncLocalStorage` is what
 * makes "current" mean per-branch rather than per-process: two racing calls each
 * see their own transaction, through an unmodified `stampSessionJoin`.
 */
const executorStore = new AsyncLocalStorage<DbTransaction>();

export function currentExecutor(): DbTransaction {
  const executor = executorStore.getStore();
  if (!executor) {
    throw new Error(
      "No transaction bound for this async context. Every call into the code " +
        "under test must be wrapped in withExecutor(tx, ...) — an unbound call " +
        "would silently open its own connection and test nothing.",
    );
  }
  return executor;
}

/** Run `fn` with `tx` as the executor the mocked `@/db` forwards to. */
export function withExecutor<T>(
  tx: DbTransaction,
  fn: () => Promise<T>,
): Promise<T> {
  return executorStore.run(tx, fn);
}

/**
 * Which backends are blocking `pid`, straight from Postgres.
 *
 * This is what turns "the second call had not finished yet" into "the second
 * call is waiting on the first one's row lock". A timer could not tell those
 * apart, and the difference is the entire point of the concurrent test.
 */
export async function blockingPids(
  watcher: TestConnection,
  pid: number,
): Promise<number[]> {
  const rows = await watcher.db.execute<{ blockers: number[] }>(
    sql`select pg_blocking_pids(${pid}) as blockers`,
  );
  return (rows[0]?.blockers ?? []).map(Number);
}

/**
 * Poll until `blockedPid` is reported as blocked by `blockerPid`.
 *
 * Polling rather than a fixed sleep: on a fast link the lock is taken in
 * milliseconds and on a slow one it is not, and a sleep long enough for the
 * second is wasted on every run of the first. Throws on timeout, which is the
 * correct failure — if the second statement never blocked, the test that
 * follows would be asserting on something other than a race.
 */
export async function waitUntilBlockedBy(
  watcher: TestConnection,
  blockedPid: number,
  blockerPid: number,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((await blockingPids(watcher, blockedPid)).includes(blockerPid)) return;
    if (Date.now() > deadline) {
      throw new Error(
        `pid ${blockedPid} was never reported as blocked by pid ${blockerPid} ` +
          `within ${timeoutMs}ms. The second stamp did not contend for the row ` +
          `lock, so the concurrency assertions below would be meaningless.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * A `Date` from the code under test, as milliseconds — and a hard assertion
 * that it really is a `Date`.
 *
 * This deliberately has **no string branch**. It used to accept both shapes,
 * because drizzle's raw `execute()` returned `timestamptz` as text while
 * `JoinStamp` declared `Date`. That is now fixed at the query boundary
 * (`toDate` in `db/queries/sessions.ts`), and a normaliser that still tolerated
 * text would stay green if the conversion were ever reverted — on the column
 * that decides what a student is billed. Permissiveness here would hide exactly
 * the regression this lane exists to catch, so a string throws.
 */
export function epochMs(value: Date | null): number {
  if (!(value instanceof Date)) {
    throw new Error(
      `Expected a Date from the code under test, got ${typeof value} ` +
        `(${JSON.stringify(value)}). stampSessionJoin promises Date in ` +
        `JoinStamp; if this is a string, the boundary conversion in ` +
        `db/queries/sessions.ts has regressed.`,
    );
  }
  return value.getTime();
}

export interface FixtureBooking {
  bookingId: string;
  studentId: string;
  tutorId: string;
}

/**
 * An `instant` / `in_progress` booking between two already-seeded profiles.
 *
 * **Reuses seeded profiles rather than creating any.** `profiles.id` is FK'd to
 * `auth.users.id` (`drizzle/0002`), so a fresh participant would mean minting
 * auth users through the Admin API and cleaning them up again — a lot of
 * apparatus for a test whose subject is one `UPDATE`. The booking row is the
 * only thing this lane creates, and the only thing it deletes.
 *
 * `type = 'instant'` also keeps the fixture clear of `bookings_no_overlap`,
 * which is `WHERE type = 'scheduled'` (`drizzle/0013`).
 *
 * **`startedAt` is expressed as an offset from Postgres's `now()`, not as a
 * JavaScript `Date`.** The end-session lane asserts behaviour at the deadline
 * boundary, where the difference between the app server's clock and the
 * database's is exactly the kind of skew that makes a test flake and then get
 * "fixed" by loosening the assertion. Seeding `now() - interval` and comparing
 * against `now()` keeps every timestamp in one clock — the one the shipped
 * predicate actually uses.
 */
export interface FixtureBookingOptions {
  /**
   * Minutes before the database's `now()` to set `started_at`. Omit for null —
   * a session whose pair never completed.
   */
  startedMinutesAgo?: number;
  /** Booked duration. Defaults to 30. */
  durationMinutes?: number;
  /** Defaults to `in_progress`, as the accept transaction leaves it. */
  status?: "in_progress" | "completed" | "confirmed";
  /** Defaults to `instant`. `scheduled` needs the window options below. */
  type?: "instant" | "scheduled";
  /**
   * Minutes before `now()` for `created_at`. Added in Part 3C: it is the clock
   * for a never-started instant booking (`created_at + duration_minutes`), so a
   * fixture for that sweep has to be able to backdate it. Defaults to the
   * column's own `now()`.
   */
  createdMinutesAgo?: number;
  /**
   * Join stamps, independently of `started_at`. Both default to the
   * `started_at` offset, which is the state the shipped join path produces (a
   * pair that met). `null` forces the column null — the absence Part 3C's
   * `no_show_*` classification reads.
   */
  studentJoinedMinutesAgo?: number | null;
  tutorJoinedMinutesAgo?: number | null;
  /**
   * For `scheduled`: minutes before `now()` that the booking was due to end.
   * `scheduled_start_at` is derived as that end minus `durationMinutes`, so the
   * window is a real one and `bookings_no_overlap` sees what it expects.
   */
  scheduledEndMinutesAgo?: number;
  /** Gross credits on the booking. Defaults to 500. */
  priceCredits?: number;
}

export async function createFixtureBooking(
  conn: TestConnection,
  options: FixtureBookingOptions = {},
): Promise<FixtureBooking> {
  const participants = await conn.db.execute<{
    student_id: string;
    tutor_id: string;
  }>(sql`
    select (select id from profiles where role = 'student' order by created_at limit 1) as student_id,
           (select id from profiles where role = 'tutor'   order by created_at limit 1) as tutor_id
  `);

  const studentId = participants[0]?.student_id;
  const tutorId = participants[0]?.tutor_id;
  if (!studentId || !tutorId) {
    throw new Error(
      "The test project has no seeded student and/or tutor profile. Run " +
        "`pnpm db:seed:test` first (docs/RUNBOOK.md, 'Test Supabase project'). " +
        "This lane deliberately does not seed — seeding is a separate, " +
        "explicitly-invoked operation.",
    );
  }

  const {
    startedMinutesAgo,
    durationMinutes = 30,
    status = "in_progress",
    type = "instant",
    createdMinutesAgo,
    studentJoinedMinutesAgo,
    tutorJoinedMinutesAgo,
    scheduledEndMinutesAgo,
    priceCredits = 500,
  } = options;

  const minutesAgo = (minutes: number | null | undefined, fallback: SQL) =>
    minutes === null
      ? sql`null`
      : minutes === undefined
        ? fallback
        : sql`now() - make_interval(mins => ${minutes})`;

  // `started_at` and both `*_joined_at` move together by default: `started_at`
  // is defined as the moment BOTH were present (§4.3), so a fixture with one set
  // and not the others would be a state the shipped join path cannot produce.
  // Part 3C's no-show cases are exactly the states where they legitimately
  // differ, which is why the two join stamps can now be overridden.
  const startedAt =
    startedMinutesAgo === undefined
      ? sql`null`
      : sql`now() - make_interval(mins => ${startedMinutesAgo})`;
  const studentJoinedAt = minutesAgo(studentJoinedMinutesAgo, startedAt);
  const tutorJoinedAt = minutesAgo(tutorJoinedMinutesAgo, startedAt);

  const createdAt =
    createdMinutesAgo === undefined
      ? sql`now()`
      : sql`now() - make_interval(mins => ${createdMinutesAgo})`;

  const scheduledEndAt =
    scheduledEndMinutesAgo === undefined
      ? sql`null`
      : sql`now() - make_interval(mins => ${scheduledEndMinutesAgo})`;
  const scheduledStartAt =
    scheduledEndMinutesAgo === undefined
      ? sql`null`
      : sql`now() - make_interval(mins => ${scheduledEndMinutesAgo + durationMinutes})`;

  const bookingId = randomUUID();
  await conn.db.execute(sql`
    insert into bookings (
      id, student_id, tutor_id, type, status, duration_minutes, price_credits,
      started_at, student_joined_at, tutor_joined_at, created_at,
      scheduled_start_at, scheduled_end_at
    )
    values (
      ${bookingId}, ${studentId}, ${tutorId}, ${type}::booking_type, ${status}::booking_status,
      ${durationMinutes}, ${priceCredits},
      ${startedAt}, ${studentJoinedAt}, ${tutorJoinedAt}, ${createdAt},
      ${scheduledStartAt}, ${scheduledEndAt}
    )
  `);

  return { bookingId, studentId, tutorId };
}

/**
 * Remove the fixture. Runs in `afterEach` so a failing assertion still cleans
 * up — a leftover `in_progress` booking would make the next run start from a
 * different state than this one did, which is how a suite quietly stops testing
 * what it claims to.
 */
export async function deleteFixtureBooking(
  conn: TestConnection,
  bookingId: string,
): Promise<void> {
  // Earnings first: `tutor_earnings.booking_id` is an FK, so a booking Part 3C's
  // sweep paid out on cannot be deleted while its row is there. Unconditional
  // rather than conditional — the DELETE is a no-op for the fixtures that never
  // earned anything, and a teardown that has to know which is which is a
  // teardown that eventually gets it wrong and leaves a row behind.
  await conn.db.execute(
    sql`delete from tutor_earnings where booking_id = ${bookingId}`,
  );
  await conn.db.execute(sql`delete from bookings where id = ${bookingId}`);
}

/**
 * The `tutor_earnings` row for a booking, if any — Part 3C's money assertion.
 *
 * Query builder, for the reason `readEndColumns` gives: the decode path differs
 * from the one the code under test writes through, so comparing the two is
 * comparing independently-decoded values rather than agreeing with itself.
 */
export async function readEarnings(conn: TestConnection, bookingId: string) {
  const [row] = await conn.db
    .select({
      tutorId: schema.tutorEarnings.tutorId,
      grossCredits: schema.tutorEarnings.grossCredits,
      platformFeeCredits: schema.tutorEarnings.platformFeeCredits,
      netCredits: schema.tutorEarnings.netCredits,
      status: schema.tutorEarnings.status,
      availableAt: schema.tutorEarnings.availableAt,
    })
    .from(schema.tutorEarnings)
    .where(eq(schema.tutorEarnings.bookingId, bookingId))
    .limit(1);
  return row ?? null;
}

/** Every column the completion sweep classifies from, plus what it wrote. */
export async function readClassification(
  conn: TestConnection,
  bookingId: string,
) {
  const [row] = await conn.db
    .select({
      status: schema.bookings.status,
      startedAt: schema.bookings.startedAt,
      endedAt: schema.bookings.endedAt,
      billedMinutes: schema.bookings.billedMinutes,
      studentJoinedAt: schema.bookings.studentJoinedAt,
      tutorJoinedAt: schema.bookings.tutorJoinedAt,
      scheduledEndAt: schema.bookings.scheduledEndAt,
      priceCredits: schema.bookings.priceCredits,
    })
    .from(schema.bookings)
    .where(eq(schema.bookings.id, bookingId))
    .limit(1);
  return row;
}

/**
 * The columns under test, read back outside any of the racing transactions.
 *
 * Uses the **query builder**, not raw `execute()`. That is deliberate: the
 * builder decodes `timestamptz` into a `Date` through drizzle's own column
 * mapper, which is a different mechanism from the boundary conversion the code
 * under test applies. So every assertion comparing a returned stamp against
 * this read is comparing two independently-decoded values — if `toDate` ever
 * drifted, the comparison would catch it rather than agree with it.
 */
export async function readJoinColumns(conn: TestConnection, bookingId: string) {
  const [row] = await conn.db
    .select({
      studentJoinedAt: schema.bookings.studentJoinedAt,
      tutorJoinedAt: schema.bookings.tutorJoinedAt,
      startedAt: schema.bookings.startedAt,
      agoraChannel: schema.bookings.agoraChannel,
    })
    .from(schema.bookings)
    .where(eq(schema.bookings.id, bookingId));
  return row;
}

/**
 * The columns the end-session transition writes, read outside any racing
 * transaction. Query builder, for the same reason `readJoinColumns` uses it: the
 * decode path differs from the one the code under test uses, so an assertion
 * comparing the two is comparing independently-decoded values.
 */
export async function readEndColumns(conn: TestConnection, bookingId: string) {
  const [row] = await conn.db
    .select({
      status: schema.bookings.status,
      startedAt: schema.bookings.startedAt,
      endedAt: schema.bookings.endedAt,
      billedMinutes: schema.bookings.billedMinutes,
      durationMinutes: schema.bookings.durationMinutes,
    })
    .from(schema.bookings)
    .where(eq(schema.bookings.id, bookingId))
    .limit(1);
  return row;
}

/**
 * Ask Postgres directly whether the shipped predicate considers this booking
 * elapsed — the SQL half of the deadline pair, evaluated on its own.
 *
 * This is what makes the boundary-agreement assertion possible: the same row is
 * put to `sessionElapsedSql` and to `hasElapsed()`, and the two must agree. It
 * imports the shipped fragment rather than restating the expression, because a
 * restated copy would agree with itself no matter what the shipped one said.
 */
export async function sqlSaysElapsed(
  conn: TestConnection,
  bookingId: string,
): Promise<boolean> {
  const { sessionElapsedSql } = await import("@/db/queries/sessions");
  const rows = await conn.db.execute<{ elapsed: boolean }>(
    sql`select ${sessionElapsedSql} as elapsed from bookings where id = ${bookingId}`,
  );
  return rows[0]?.elapsed === true;
}

/** The row's `started_at`/`duration_minutes` as the TypeScript half sees them. */
export async function readTiming(conn: TestConnection, bookingId: string) {
  const row = await readEndColumns(conn, bookingId);
  return { startedAt: row.startedAt, durationMinutes: row.durationMinutes };
}
