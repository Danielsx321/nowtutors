import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
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
 * Postgres timestamp → microseconds since the epoch.
 *
 * **Drizzle's raw `execute()` returns `timestamptz` as a STRING, not a `Date`**
 * — it turns off postgres-js's own type parsers and relies on its column
 * mappers to convert, and a raw `sql` query has no column mappers. So
 * `stampSessionJoin`'s `JoinStamp`, which declares `Date | null`, actually
 * carries strings like `2026-08-24 10:48:18.051472+00` at runtime. Nothing
 * shipped reads those three fields today (`/api/agora/token` uses only
 * `agoraChannel`), so it is latent rather than broken — but Part 3B computes
 * elapsed time from `startedAt`, which is where a `.getTime()` on a string
 * stops being latent. Reported, deliberately not fixed here: this pass changes
 * no shipped behaviour. See docs/PROGRESS.md.
 *
 * Accepts both shapes so the assertions stay true whichever the driver hands
 * back, and keeps full microsecond precision — `Date` would truncate to
 * milliseconds and could make two genuinely different stamps compare equal.
 */
export function toEpochMicros(value: Date | string): number {
  if (value instanceof Date) return value.getTime() * 1_000;

  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?(.*)$/.exec(
    value,
  );
  if (!match) {
    throw new Error(`Unrecognised Postgres timestamp: ${JSON.stringify(value)}`);
  }
  const [, date, time, fraction = "", zone] = match;
  // Postgres writes `+00`; `Date.parse` wants `+00:00` or `Z`. The fractional
  // part is parsed separately rather than handed to `Date.parse`, which would
  // drop everything below a millisecond.
  const normalisedZone =
    zone === "" ? "Z" : /^[+-]\d{2}$/.test(zone) ? `${zone}:00` : zone;
  const ms = Date.parse(`${date}T${time}${normalisedZone}`);
  if (Number.isNaN(ms)) {
    throw new Error(`Unparseable Postgres timestamp: ${JSON.stringify(value)}`);
  }
  return ms * 1_000 + Math.round(Number(`0${fraction || ".0"}`) * 1_000_000);
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
 */
export async function createFixtureBooking(
  conn: TestConnection,
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

  const bookingId = randomUUID();
  await conn.db.execute(sql`
    insert into bookings (id, student_id, tutor_id, type, status, duration_minutes, price_credits)
    values (${bookingId}, ${studentId}, ${tutorId}, 'instant', 'in_progress', 30, 500)
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
  await conn.db.execute(sql`delete from bookings where id = ${bookingId}`);
}

/** The columns under test, read back outside any of the racing transactions. */
export async function readJoinColumns(conn: TestConnection, bookingId: string) {
  const rows = await conn.db.execute<{
    student_joined_at: Date | string | null;
    tutor_joined_at: Date | string | null;
    started_at: Date | string | null;
    agora_channel: string | null;
  }>(sql`
    select student_joined_at, tutor_joined_at, started_at, agora_channel
      from bookings
     where id = ${bookingId}
  `);
  return rows[0];
}
