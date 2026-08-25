import { sql, type SQL } from "drizzle-orm";

/**
 * **The one definition of the first-join rule** (SPEC §4.3, §7.4, §7.7 step 4).
 *
 * Two statements write a participant's arrival: `stampSessionJoin` for the
 * instant/Agora path (`db/queries/sessions.ts`, §7.4) and
 * `stampScheduledSessionJoin` for the scheduled/LessonSpace path
 * (`db/queries/classroom.ts`, §7.7). They differ in what else they touch — the
 * instant one backfills `agora_channel` and never writes `status`; the scheduled
 * one persists `lessonspace_room_id` and advances `confirmed → in_progress` —
 * but the part that decides **`started_at`**, the clock the hard stop and the
 * completion cron both measure against, is defined **here, once**, and imported
 * by both. Two writers of `started_at` drift; two *copies* of the rule drift
 * just as quietly, which is why this is a shared fragment rather than a comment
 * asking the next person to keep two statements in step.
 *
 * ## The `b` alias is part of the contract
 *
 * Every fragment below references `b.*`. Both consumers are raw
 * `update bookings b set …` statements, and that is **not** an incidental style
 * choice:
 *
 *  - **Read the target table, never a CTE.** Under READ COMMITTED an `UPDATE`
 *    that blocks on a row another transaction is writing re-evaluates its
 *    qualifiers *and its SET expressions* against the **updated** row once the
 *    lock clears. A CTE is materialized from the original snapshot and is not
 *    re-read, so a second party joining in the same instant would push the first
 *    party's stamp back to null — a session that is "started" with a participant
 *    who, per the row, never arrived. This is proved, not asserted, by
 *    `tests/integration/session-join-concurrency.test.ts` (instant) and
 *    `tests/integration/scheduled-join-concurrency.test.ts` (scheduled).
 *    See docs/DECISIONS.md, Phase 6 Part 3A item 3.
 *  - A consumer that aliases the table differently, or drops the alias, will not
 *    compile into valid SQL. That is deliberate: it fails loudly at the one
 *    place a reviewer is looking, rather than silently reading the wrong row.
 *
 * Anything added here must hold for **both** paths. A rule that is true only of
 * instant sessions belongs in `sessions.ts`; only of scheduled ones, in
 * `classroom.ts`.
 */

/**
 * True on exactly the write that puts **both** parties in the room.
 *
 * It tests the **other** party's column, never the arriving one: after the
 * statement the arriving side is stamped by definition, so the pair is complete
 * precisely when the other side already was. `started_at` is defined as "first
 * moment both were present" (§4.3), and starting it on first arrival instead
 * would bill a student for minutes spent alone in the room waiting for a tutor
 * who had not shown up — with no refund and no grace period (§7.4), that is
 * money. See docs/DECISIONS.md, Phase 6 Part 3A item 2.
 *
 * Used by {@link joinStampAssignments} for `started_at` **and** by the scheduled
 * statement for its `confirmed → in_progress` transition, so the two can never
 * disagree about when a session has begun: same predicate, same row, same
 * statement, evaluated once against the same pre-write snapshot.
 */
export function pairCompletesOnThisWrite(userId: string): SQL {
  return sql`(b.student_id = ${userId} and b.tutor_joined_at is not null)
              or (b.tutor_id = ${userId} and b.student_joined_at is not null)`;
}

/**
 * The three column assignments every join write shares, as one SQL fragment:
 * `student_joined_at`, `tutor_joined_at`, `started_at`.
 *
 * Drop it into a statement's `SET` list; the caller adds its own path-specific
 * assignments (and its own `updated_at`) around it.
 *
 *  - `student_joined_at` / `tutor_joined_at` — stamped for the **arriving side
 *    only**, and only when null. First arrival wins; a refresh, a second tab or
 *    a token renewal does not restamp.
 *  - `started_at` — set **only** on the write that completes the pair, and never
 *    moved once written (the `is not null` branch comes first, so an already-
 *    started session keeps its original instant no matter who calls again).
 *
 * `now()` is the transaction timestamp, so a participant's arrival stamp and the
 * `started_at` it completes are the same instant rather than microseconds apart.
 *
 * Postgres evaluates every `SET` expression against the **old** row and applies
 * them simultaneously, so these three (and any predicate the caller reuses) all
 * see one consistent pre-write snapshot regardless of the order they are listed
 * in.
 */
export function joinStampAssignments(userId: string): SQL {
  return sql`
      student_joined_at = case when b.student_id = ${userId}
                               then coalesce(b.student_joined_at, now())
                               else b.student_joined_at end,
      tutor_joined_at   = case when b.tutor_id = ${userId}
                               then coalesce(b.tutor_joined_at, now())
                               else b.tutor_joined_at end,
      started_at        = case
                            when b.started_at is not null then b.started_at
                            when ${pairCompletesOnThisWrite(userId)} then now()
                            else null
                          end`;
}

/** The three timestamps every join write returns. Both paths' result types
 *  extend this, so the shared rule has one shared shape as well. */
export interface JoinStampTimestamps {
  studentJoinedAt: Date | null;
  tutorJoinedAt: Date | null;
  startedAt: Date | null;
}

/**
 * Postgres timestamp text → `Date`, at the one boundary that produces it.
 *
 * Drizzle's raw `execute()` hands `timestamptz` back as the text Postgres
 * printed — `2026-08-24 11:18:57.085553+00` — not a `Date`. The query builder
 * and `.returning()` both decode the same column into a real `Date`; only the
 * raw path does not (all three probed against the test project, 2026-08-24 —
 * see docs/DECISIONS.md for the control table).
 *
 * It lives **here**, beside the fragment, because both join statements are raw
 * `execute()` calls and both promise `Date`s. A per-path copy would be a second
 * decode path to get wrong, on the column that decides what a student is billed
 * — the same reasoning that put the SQL rule itself in this file.
 *
 * Sub-millisecond precision is dropped, exactly as the query builder drops it
 * (`.085553+00` → `.085Z` both ways, floored not rounded), so a value read
 * through here and the same value read through the builder compare equal.
 *
 * A `Date` passes through untouched: if a future drizzle release decodes raw
 * `execute()` the way the builder already does, this becomes a no-op rather
 * than a second bug.
 */
export function toDate(value: string | Date | null): Date | null {
  if (value === null) return null;
  if (value instanceof Date) return value;

  // `timestamptz` always prints an offset. Requiring one is what stops a
  // hypothetical offset-less value from being silently read as local time —
  // which `Date` would do happily, and which would be a wrong billing clock
  // rather than a loud failure.
  if (!/(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(value)) {
    throw new Error(
      `Timestamp from Postgres carries no UTC offset: ${JSON.stringify(value)}`,
    );
  }
  // Postgres prints `YYYY-MM-DD HH:MM:SS[.ffffff]+HH`; `Date` needs the `T`
  // separator and a two-part offset.
  const parsed = new Date(value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `Unparseable timestamp from Postgres: ${JSON.stringify(value)}`,
    );
  }
  return parsed;
}
