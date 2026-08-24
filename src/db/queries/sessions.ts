import "server-only";
import { aliasedTable, and, eq, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { bookings, profiles, subjects } from "@/db/schema";
import { sessionChannel } from "@/lib/session-requests/accept";
import type { SessionBookingRow } from "@/lib/agora/session-access";

/**
 * The session room's reads and its two writes (SPEC §7.4, §4.3).
 *
 * All of them take an already-authorized user id from the caller's session. The
 * writes are server-side only: `started_at` is the clock the hard stop measures
 * against and `ended_at` is the moment it stopped, so nothing about either may
 * originate in a browser.
 */

/** The booking behind a session room, for the access check. Participant-agnostic. */
export async function getSessionBooking(
  bookingId: string,
): Promise<SessionBookingRow | null> {
  const [row] = await db
    .select({
      id: bookings.id,
      studentId: bookings.studentId,
      tutorId: bookings.tutorId,
      status: bookings.status,
      type: bookings.type,
      agoraChannel: bookings.agoraChannel,
      // Read so `checkSessionAccess` can refuse an elapsed session its token
      // (§7.4). Without these two the access check has no way to tell a live
      // room from one whose booked duration ran out while somebody sat in it.
      startedAt: bookings.startedAt,
      durationMinutes: bookings.durationMinutes,
    })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  return row ?? null;
}

export interface SessionRoomView {
  bookingId: string;
  status: string;
  /** `instant` renders the Agora room; `scheduled` is LessonSpace (Phase 7). */
  type: string;
  durationMinutes: number | null;
  /** "First moment both were present" (§4.3); null until the pair completes. */
  startedAt: Date | null;
  /** Set by the transition. Non-null means the room is closed. */
  endedAt: Date | null;
  subjectName: string | null;
  /** True when the viewer is the booking's tutor. Server-derived. */
  viewerIsTutor: boolean;
  viewerName: string;
  viewerAvatarUrl: string | null;
  otherPartyName: string;
  otherPartyAvatarUrl: string | null;
}

/**
 * Everything `/session/[bookingId]` renders, for one participant, in one trip.
 *
 * **Returns null both when the booking does not exist and when the viewer is not
 * in it**, so the page cannot be used to find out which booking ids are real —
 * the same choice `getBookingDetailForParticipant` and `checkDirectPayEligibility`
 * already make. The page turns either into the same `notFound()`.
 *
 * Deliberately separate from `getBookingDetailForParticipant`, which filters to
 * `type = 'scheduled'` and resolves only the *other* party. The room needs both
 * sides — a participant's own name labels their own tile.
 */
export async function getSessionRoomView(
  bookingId: string,
  userId: string,
): Promise<SessionRoomView | null> {
  const student = aliasedTable(profiles, "student_p");
  const tutor = aliasedTable(profiles, "tutor_p");

  const [row] = await db
    .select({
      id: bookings.id,
      status: bookings.status,
      type: bookings.type,
      studentId: bookings.studentId,
      tutorId: bookings.tutorId,
      durationMinutes: bookings.durationMinutes,
      startedAt: bookings.startedAt,
      endedAt: bookings.endedAt,
      subjectName: subjects.name,
      studentName: student.displayName,
      studentFullName: student.fullName,
      studentAvatarUrl: student.avatarUrl,
      tutorName: tutor.displayName,
      tutorFullName: tutor.fullName,
      tutorAvatarUrl: tutor.avatarUrl,
    })
    .from(bookings)
    .leftJoin(subjects, eq(subjects.id, bookings.subjectId))
    .innerJoin(student, eq(student.id, bookings.studentId))
    .innerJoin(tutor, eq(tutor.id, bookings.tutorId))
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!row) return null;
  const viewerIsTutor = row.tutorId === userId;
  if (!viewerIsTutor && row.studentId !== userId) return null;

  const studentLabel = row.studentName ?? row.studentFullName ?? "Student";
  const tutorLabel = row.tutorName ?? row.tutorFullName ?? "Tutor";

  return {
    bookingId: row.id,
    status: row.status,
    type: row.type,
    durationMinutes: row.durationMinutes,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    subjectName: row.subjectName,
    viewerIsTutor,
    viewerName: viewerIsTutor ? tutorLabel : studentLabel,
    viewerAvatarUrl: viewerIsTutor ? row.tutorAvatarUrl : row.studentAvatarUrl,
    otherPartyName: viewerIsTutor ? studentLabel : tutorLabel,
    otherPartyAvatarUrl: viewerIsTutor ? row.studentAvatarUrl : row.tutorAvatarUrl,
  };
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
 * `JoinStamp` is this module's public shape and it promises `Date`, so the
 * conversion belongs here, **once**. It is deliberately not solved by widening
 * `JoinStamp` to `Date | string`: `started_at` is the clock Part 3B's hard stop
 * measures against, and a coercion repeated at every consumer is a coercion one
 * consumer eventually gets wrong — on the column that decides what a student is
 * billed.
 *
 * Sub-millisecond precision is dropped, exactly as the query builder drops it
 * (`.085553+00` → `.085Z` both ways, floored not rounded), so a value read
 * through here and the same value read through the builder compare equal.
 *
 * A `Date` passes through untouched: if a future drizzle release decodes raw
 * `execute()` the way the builder already does, this becomes a no-op rather
 * than a second bug.
 */
function toDate(value: string | Date | null): Date | null {
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

export interface JoinStamp {
  agoraChannel: string | null;
  studentJoinedAt: Date | null;
  tutorJoinedAt: Date | null;
  startedAt: Date | null;
}

/**
 * Record a participant's arrival in the session room, idempotently.
 *
 * **One statement, and no CTE.** A read-then-write — "is `started_at` null? if so
 * set it" — races with a refresh, a second tab, or the other party arriving in
 * the same moment, and every lost race moves the billing clock. Expressing the
 * whole decision in SQL makes a repeat call a no-op by construction rather than
 * by timing luck, and one statement needs no transaction to protect it.
 *
 * The conditions read `b.*` directly rather than a CTE **on purpose**. Under READ
 * COMMITTED an UPDATE that blocks on a row another transaction is writing
 * re-evaluates its qualifiers and its SET expressions against the *updated* row
 * once the lock is released — but a CTE is materialized from the original
 * snapshot and is not re-read. With both parties clicking join at the same
 * instant, a CTE-sourced value would write back the stale null and erase the
 * stamp the other side had just made. Referencing the target table keeps the
 * write correct under exactly the concurrency this route will see.
 *
 * What it sets, and why each is conditional:
 *
 *  - `agora_channel` — backfilled to `session_{booking_id}` only when null. The
 *    accept transaction already writes it (`db/queries/session-requests.ts`), so
 *    in practice this never fires; it is here because a null channel would
 *    otherwise be an unrecoverable dead room, and `sessionChannel()` derives the
 *    same value the accept path used rather than inventing a second scheme.
 *  - `student_joined_at` / `tutor_joined_at` — stamped for the arriving side
 *    only, and only when null. First arrival wins; a refresh does not restamp.
 *  - `started_at` — **set only on the write that makes BOTH joined-at columns
 *    non-null**, which is why it tests the *other* party's column: after this
 *    statement the arriving side is stamped by definition, so the pair is
 *    complete exactly when the other side already was. SPEC §4.3 defines
 *    `started_at` as "first moment both were present" and §7.4 makes it the clock
 *    the hard stop is computed from. Starting it on first arrival instead would
 *    bill a student for minutes spent alone in the room waiting for a tutor who
 *    hadn't shown up — with no refund and no grace period (§7.4), that is money.
 *
 * `now()` is the transaction timestamp, so the joined-at stamp and the
 * `started_at` it completes are the same instant rather than microseconds apart.
 *
 * The WHERE re-checks participation and `in_progress` even though
 * `checkSessionAccess` already did: that guard ran against a row read a moment
 * earlier, and this is the statement that actually changes something. Returns
 * null when nothing matched, which the caller reads as "no longer joinable".
 *
 * Does not touch `status`. Instant bookings are inserted `in_progress` by the
 * accept transaction (§7.4) — there is no earlier state to advance from, and a
 * booking that is not already `in_progress` fails the WHERE instead.
 *
 * The three timestamps are normalised through {@link toDate} on the way out, so
 * the returned `JoinStamp` really does carry `Date`s. Callers — Part 3B's
 * elapsed-time computation above all — can use them as dates without a
 * per-consumer coercion.
 */
export async function stampSessionJoin(
  bookingId: string,
  userId: string,
): Promise<JoinStamp | null> {
  const channel = sessionChannel(bookingId);

  // `string | Date` rather than `Date`: this generic is an assertion about
  // untyped driver output, and the raw path currently yields text. Claiming the
  // weaker shape is what makes `toDate` below the thing that decides, instead of
  // a cast that silently disagrees with runtime.
  const rows = await db.execute<{
    agora_channel: string | null;
    student_joined_at: string | Date | null;
    tutor_joined_at: string | Date | null;
    started_at: string | Date | null;
  }>(sql`
    update bookings b
       set agora_channel     = coalesce(b.agora_channel, ${channel}),
           student_joined_at = case when b.student_id = ${userId}
                                    then coalesce(b.student_joined_at, now())
                                    else b.student_joined_at end,
           tutor_joined_at   = case when b.tutor_id = ${userId}
                                    then coalesce(b.tutor_joined_at, now())
                                    else b.tutor_joined_at end,
           started_at        = case
                                 when b.started_at is not null then b.started_at
                                 when b.student_id = ${userId}
                                  and b.tutor_joined_at is not null then now()
                                 when b.tutor_id = ${userId}
                                  and b.student_joined_at is not null then now()
                                 else null
                               end,
           updated_at        = now()
     where b.id = ${bookingId}
       and b.status = 'in_progress'
       and (b.student_id = ${userId} or b.tutor_id = ${userId})
    returning b.agora_channel, b.student_joined_at, b.tutor_joined_at, b.started_at
  `);

  const row = rows[0];
  if (!row) return null;
  return {
    agoraChannel: row.agora_channel,
    studentJoinedAt: toDate(row.student_joined_at),
    tutorJoinedAt: toDate(row.tutor_joined_at),
    startedAt: toDate(row.started_at),
  };
}

/**
 * `started_at + duration_minutes` — the hard stop, expressed in SQL (§7.4).
 *
 * **The single source of truth for "when is this session over", and the one
 * Part 3C's `complete-sessions` cron must call rather than re-derive.** SPEC §12
 * describes that cron in scheduled-booking terms ("past `scheduled_end_at +
 * 30m`"), and `scheduled_end_at` is NULL for every instant booking (§4.3) — so
 * a cron written from §12 alone would need to invent an instant predicate, and
 * the invented one is exactly where a second, subtly different notion of
 * "elapsed" comes from. It is exported for that reason. §12 has been amended to
 * point here.
 *
 * The columns are referenced through drizzle's own column objects, so they
 * render as `"bookings"."started_at"` — the target table, read live. That is the
 * same choice `stampSessionJoin` makes and for the same reason (see its note on
 * CTEs); it matters here because these fragments appear inside an `UPDATE` on
 * the very row they read.
 *
 * Null-safe by construction: `NULL + interval` is `NULL`, and `NULL <= now()` is
 * not true, so a booking that never started can never match. The TypeScript half
 * ({@link import("@/lib/sessions/deadline").sessionDeadline}) returns null for
 * the same inputs, and the integration lane pins the two together at the
 * boundary.
 */
export const sessionDeadlineSql: SQL = sql`${bookings.startedAt} + make_interval(mins => ${bookings.durationMinutes})`;

/** True once the booked duration has run out. Inclusive at the boundary. */
export const sessionElapsedSql: SQL = sql`${sessionDeadlineSql} <= now()`;

/** What the transition returns, for the caller and for Part 3C's earnings read. */
export interface EndedSession {
  bookingId: string;
  studentId: string;
  tutorId: string;
  startedAt: Date | null;
  endedAt: Date | null;
  durationMinutes: number | null;
  /** Gross credits, already charged at accept. Part 3C splits this (§7.11). */
  priceCredits: number | null;
  billedMinutes: number | null;
}

/**
 * Move one instant session to `completed`, idempotently and exactly once.
 *
 * **One statement, no CTE, no read-then-write, no wrapping transaction** — the
 * same shape and the same reasoning as `stampSessionJoin` above.
 *
 * ## Exactly one transition, guaranteed by Postgres rather than by timing
 *
 * `status = 'in_progress'` in the WHERE is the entire guarantee. Two ends
 * landing together — both parties clicking End, or an end racing the deadline —
 * serialize on the row lock; when the first commits, the second re-evaluates its
 * qualifiers against the *updated* row under READ COMMITTED, sees `completed`,
 * and matches **zero rows**. Its `RETURNING` is empty and it writes nothing. A
 * repeat call after the fact is the same zero-row no-op, which is what makes
 * this idempotent by construction instead of by luck.
 *
 * The `ended_at` CASE reads the target table directly rather than a CTE. A
 * blocked writer never reaches those SET expressions (the status guard stops it
 * first), so here that is defence in depth rather than the load-bearing part —
 * but it is written this way because the next person to edit this statement will
 * copy its shape, and a CTE would be materialized from the pre-block snapshot
 * and silently write back stale values (docs/DECISIONS.md, Part 3A item 3).
 *
 * **That property is NOT covered by a test, and cannot usefully be.** The
 * falsification pass rewrote these SET expressions to read a pre-write snapshot
 * — the CTE defect exactly — and all thirteen integration tests still passed,
 * because the status guard means no second writer ever evaluates them. Making it
 * observable would mean removing the status guard too, and a test that only
 * fails under two simultaneous breaks guards nothing. So this is upheld by
 * review, not by the suite: **if you remove the status guard, this stops being
 * defence in depth and becomes load-bearing, with nothing to catch you.**
 *
 * ## `ended_at` is capped at the deadline
 *
 * An end that happens *after* the deadline records the deadline, not the moment
 * somebody noticed. See docs/DECISIONS.md, "`ended_at` is capped at the
 * deadline" — Part 3C depends on this silently, and simplifying it to `now()`
 * would move every late-swept tutor's `available_at`.
 *
 * ## `started_at IS NOT NULL`
 *
 * A session where the pair never completed cannot reach `completed` through this
 * statement. Without the clause, a student whose tutor never arrived could click
 * End, and Part 3C would then pay a tutor who was never in the room while §7.4
 * forbids refunding the student — a double loss with no recovery path. Leaving
 * such a booking `in_progress` with both `*_joined_at` intact is what lets Part
 * 3C classify it `no_show_student` / `no_show_tutor` from full information (§12).
 *
 * ## `billed_minutes = duration_minutes`
 *
 * Under §7.4's flat upfront billing the minutes *billed* are the minutes booked,
 * always — there is no metering, no proration and no refund, so nothing else
 * could be meant by the column. §4.3's older "instant: actual" wording is a
 * survivor of the hold model migration `0014` dismantled and has been corrected
 * in this commit. Actual elapsed is never lost: it is `ended_at - started_at`.
 *
 * ## What this does NOT do
 *
 * No ledger call, no refund, no proration, no `tutor_earnings` (Part 3C), and
 * **no `is_live` write** — presence belongs to the heartbeat and the sweep, and
 * §7.5 calls out ending a session clearing `is_live` as an explicit
 * non-behaviour precisely because an implementer will assume it is a missing
 * step.
 *
 * Written through the query builder rather than raw `execute()` **on purpose**:
 * `.returning()` decodes `timestamptz` into a real `Date`, so `ended_at` needs
 * no `toDate` boundary and this pass introduces no second decode path to get
 * wrong (docs/DECISIONS.md, `fix/join-stamp-timestamptz`).
 *
 * Returns null when nothing matched — already ended, never started, not this
 * caller's, or not an instant booking. The caller decides which of those the
 * user is allowed to be told.
 */
async function endInstantSession(
  bookingId: string,
  tail: SQL,
): Promise<EndedSession | null> {
  const [row] = await db
    .update(bookings)
    .set({
      status: "completed",
      // The cap. `now()` is the transaction timestamp, so the comparison in the
      // CASE and the value it may write are the same instant.
      endedAt: sql`case when ${sessionElapsedSql} then ${sessionDeadlineSql} else now() end`,
      billedMinutes: sql`${bookings.durationMinutes}`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(bookings.id, bookingId),
        // Scheduled bookings end in LessonSpace (§7.7, Phase 7), not here.
        eq(bookings.type, "instant"),
        // The exactly-once guard. Do not remove: without it a second call
        // re-stamps `ended_at` and moves the tutor's earnings hold.
        eq(bookings.status, "in_progress"),
        isNotNull(bookings.startedAt),
        tail,
      ),
    )
    .returning({
      bookingId: bookings.id,
      studentId: bookings.studentId,
      tutorId: bookings.tutorId,
      startedAt: bookings.startedAt,
      endedAt: bookings.endedAt,
      durationMinutes: bookings.durationMinutes,
      priceCredits: bookings.priceCredits,
      billedMinutes: bookings.billedMinutes,
    });

  return row ?? null;
}

/**
 * Either participant ends the session early (§7.4).
 *
 * No deadline condition — ending early is the point. Credits were charged at
 * accept and **nothing is refunded**, by either party, with no proration and no
 * grace period.
 *
 * Participation is re-checked in the WHERE even though the caller already
 * resolved it: that check ran against a row read a moment earlier, and this is
 * the statement that actually changes something.
 */
export async function endInstantSessionByParticipant(
  bookingId: string,
  userId: string,
): Promise<EndedSession | null> {
  return endInstantSession(
    bookingId,
    or(eq(bookings.studentId, userId), eq(bookings.tutorId, userId))!,
  );
}

/**
 * The booked duration has run out — close the room (§7.4's hard stop).
 *
 * No participant condition: the deadline belongs to the booking, not to whoever
 * happened to notice it. Callers in this pass are `getSessionState` (the actor
 * at the deadline, with people still in the room) and `/api/agora/token` (which
 * refuses re-entry afterwards). Part 3C's cron is the same statement with the
 * id predicate dropped.
 *
 * The elapsed comparison lives **here, in SQL**, rather than in the caller: a
 * browser's clock running fast must not be able to end a paid session early, and
 * `now()` is Postgres's clock. A caller that asks too early simply matches zero
 * rows.
 */
export async function endElapsedInstantSession(
  bookingId: string,
): Promise<EndedSession | null> {
  return endInstantSession(bookingId, sessionElapsedSql);
}
