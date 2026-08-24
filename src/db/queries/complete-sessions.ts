import "server-only";
import { and, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { bookings } from "@/db/schema";
import {
  endElapsedInstantSession,
  sessionElapsedSql,
  type EndedSession,
} from "@/db/queries/sessions";

/**
 * The `complete-sessions` sweep's work sets and transitions (SPEC §12, §7.11).
 *
 * Three predicates, not one, because the three shapes have different clocks:
 *
 *  1. **Instant, started** — `started_at + duration_minutes <= now()`, expressed
 *     by the shared {@link sessionElapsedSql} fragment. These are closed through
 *     the shipped `endElapsedInstantSession`, not by a statement written here.
 *  2. **Instant, never started** — `created_at + duration_minutes <= now()`.
 *     `sessionElapsedSql` is null-safe and matches none of these, so without a
 *     clock of their own they would sit `in_progress` forever.
 *  3. **Scheduled** — `scheduled_end_at + 30m <= now()`, the predicate §12 has
 *     always described.
 *
 * Every one of them is idempotent by construction: each transition moves the row
 * out of the status its own predicate matches on, so a double-fire or a retry
 * matches zero rows and returns nothing.
 */

/** A booking this sweep transitioned, and everything §7.11 needs from it. */
export interface SweptBooking {
  bookingId: string;
  tutorId: string;
  studentId: string;
  /** The classification that was written: `completed` | `no_show_*`. */
  status: string;
  /** Gross credits for the earnings split. Charged at booking, never refunded. */
  priceCredits: number | null;
  /** What `available_at` is derived from (§7.11). Never null after a sweep. */
  endedAt: Date | null;
}

/** The grace §12 gives a scheduled booking after its end before the sweep acts. */
export const SCHEDULED_GRACE_MINUTES = 30;

/**
 * Which of `completed` / `no_show_tutor` / `no_show_student` a row lands on.
 *
 * **`started_at` is the whole question.** §4.3 defines it as "first moment both
 * were present", so a non-null value is proof the pair met and the row is
 * `completed`. A null one means they never both were, and the two `*_joined_at`
 * columns say who was missing.
 *
 * **Tutor-absence takes precedence, so both-null lands `no_show_tutor`.** That
 * asymmetry is deliberate and it is a money decision, not a tie-break: a
 * `no_show_tutor` row writes no `tutor_earnings` (§7.11), so the safe direction
 * when the record cannot say who failed to show is the one that does not pay a
 * tutor who was not in the room. The opposite default would pay in full on the
 * evidence of an empty room.
 *
 * One fragment, shared by both statements below, because a classification stated
 * twice is a classification that can disagree with itself — the same reasoning
 * that made `sessionElapsedSql` a shared export.
 *
 * The cast is required: the CASE arms are unknown-typed literals which Postgres
 * resolves to `text`, and there is no assignment cast from `text` to the
 * `booking_status` enum.
 */
const classifiedStatusSql: SQL = sql`(case
    when ${bookings.startedAt} is not null then 'completed'
    when ${bookings.tutorJoinedAt} is null then 'no_show_tutor'
    when ${bookings.studentJoinedAt} is null then 'no_show_student'
    else 'completed'
  end)::booking_status`;

/** The columns every sweep returns, in one place so the shapes cannot drift. */
const sweptColumns = {
  bookingId: bookings.id,
  tutorId: bookings.tutorId,
  studentId: bookings.studentId,
  status: bookings.status,
  priceCredits: bookings.priceCredits,
  endedAt: bookings.endedAt,
} as const;

/**
 * Instant bookings whose booked duration has run out with the pair still in the
 * room — the ids, not a transition.
 *
 * This is a **read**. The transition is `endElapsedInstantSession`, called once
 * per id by the route, because that shipped statement carries the `ended_at`
 * cap (`started_at + duration_minutes`, never `now()`) that §7.11's
 * `available_at` is derived from. A bulk `UPDATE` written here would have to
 * restate the cap, and a cron running twenty minutes late must write the
 * byte-identical `ended_at` a participant would have written at the deadline —
 * see docs/DECISIONS.md, "`ended_at` is capped at the deadline". One statement
 * per elapsed session is the cost of not owning a second copy of that rule, and
 * on a 15-minute cadence the work set is a handful of rows.
 *
 * The predicate is the shared {@link sessionElapsedSql}, never a restatement:
 * a second notion of "elapsed" on the column that decides what a student is
 * billed is precisely what that export exists to prevent (§12).
 */
export async function findElapsedInstantSessionIds(): Promise<string[]> {
  const rows = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.type, "instant"),
        eq(bookings.status, "in_progress"),
        // Redundant against `sessionElapsedSql` (NULL + interval is NULL, and
        // NULL <= now() is not true) and stated anyway: it is what makes the
        // split between this work set and the no-show one visible at a glance.
        isNotNull(bookings.startedAt),
        sessionElapsedSql,
      ),
    );
  return rows.map((r) => r.id);
}

/** {@link endElapsedInstantSession}, re-exported so the route has one import. */
export { endElapsedInstantSession, type EndedSession };

/**
 * Instant bookings whose booked window passed without the pair ever meeting.
 *
 * **The clock is `created_at + duration_minutes`.** An instant booking is
 * created by the accept transaction and begins immediately (§7.4), so
 * `created_at` is the instant analogue of `scheduled_start_at` and this is the
 * same booked window the hard stop measures — not a second definition of it.
 * `started_at IS NULL` is part of the predicate and not only of the
 * classification: a pair that connected late has a `started_at`, so it is swept
 * by the elapsed path above with its capped `ended_at` instead of landing here.
 *
 * **No grace.** `ended_at` is `now()` for these rows — there is no session end
 * to record, so the stamp is the moment of classification — and §7.11 derives
 * `available_at` from `ended_at`, so any grace period would add its own length
 * to the tutor's withdrawal date for a session that never happened.
 *
 * `billed_minutes = duration_minutes` because the student was charged the full
 * price at accept and §7.4 refunds nothing, on any path. The column records what
 * was billed, and the answer is the same whether or not anyone showed up.
 */
export async function sweepInstantNoShows(): Promise<SweptBooking[]> {
  return db
    .update(bookings)
    .set({
      status: classifiedStatusSql,
      // Observation, not occurrence — the one case where that is correct,
      // because there is no occurrence (§7.11).
      endedAt: sql`now()`,
      billedMinutes: sql`${bookings.durationMinutes}`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(bookings.type, "instant"),
        // The idempotence guard: the row leaves `in_progress` here, so the
        // predicate stops matching it and a second run moves nothing.
        eq(bookings.status, "in_progress"),
        isNull(bookings.startedAt),
        sql`${bookings.createdAt} + make_interval(mins => ${bookings.durationMinutes}) <= now()`,
      ),
    )
    .returning(sweptColumns);
}

/**
 * Scheduled bookings past `scheduled_end_at + 30m` (§12's original predicate).
 *
 * `ended_at = scheduled_end_at`, not `now()`: the session ended when it was
 * booked to end, and the sweep is merely the thing that noticed. That keeps a
 * late run from moving `available_at`, for exactly the reason the instant path's
 * cap does — one rule, two clocks.
 *
 * The 30-minute grace is what makes that safe to state: a session that ran over
 * is still recorded as ending at its scheduled end, so the grace buys the room
 * time to finish without the sweep closing it underneath anyone.
 */
export async function sweepElapsedScheduledSessions(): Promise<SweptBooking[]> {
  return db
    .update(bookings)
    .set({
      status: classifiedStatusSql,
      endedAt: sql`${bookings.scheduledEndAt}`,
      // §4.3: "scheduled: planned". Flat billing again — the student paid for
      // the booked hour whether or not it was used.
      billedMinutes: sql`${bookings.durationMinutes}`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(bookings.type, "scheduled"),
        // Both live states, and the same idempotence guard: the row leaves this
        // set the moment it is classified.
        inArray(bookings.status, ["confirmed", "in_progress"]),
        sql`${bookings.scheduledEndAt} + make_interval(mins => ${SCHEDULED_GRACE_MINUTES}) <= now()`,
      ),
    )
    .returning(sweptColumns);
}
