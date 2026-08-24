import "server-only";
import { aliasedTable, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bookings, profiles, subjects } from "@/db/schema";
import { sessionChannel } from "@/lib/session-requests/accept";
import type { SessionBookingRow } from "@/lib/agora/session-access";

/**
 * The session room's read and its one write (SPEC §7.4, §4.3).
 *
 * Both take an already-authorized user id from the caller's session. The write
 * is server-side only and reachable exclusively through `/api/agora/token`:
 * `started_at` is the clock Part 3B's hard stop measures against, so nothing
 * about it may originate in a browser.
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
    subjectName: row.subjectName,
    viewerIsTutor,
    viewerName: viewerIsTutor ? tutorLabel : studentLabel,
    viewerAvatarUrl: viewerIsTutor ? row.tutorAvatarUrl : row.studentAvatarUrl,
    otherPartyName: viewerIsTutor ? studentLabel : tutorLabel,
    otherPartyAvatarUrl: viewerIsTutor ? row.studentAvatarUrl : row.tutorAvatarUrl,
  };
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
 */
export async function stampSessionJoin(
  bookingId: string,
  userId: string,
): Promise<JoinStamp | null> {
  const channel = sessionChannel(bookingId);

  const rows = await db.execute<{
    agora_channel: string | null;
    student_joined_at: Date | null;
    tutor_joined_at: Date | null;
    started_at: Date | null;
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
    studentJoinedAt: row.student_joined_at,
    tutorJoinedAt: row.tutor_joined_at,
    startedAt: row.started_at,
  };
}
