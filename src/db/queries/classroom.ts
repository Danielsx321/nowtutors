import "server-only";
import { aliasedTable, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bookings, profiles, subjects } from "@/db/schema";
import type { LessonSpaceBookingRow } from "@/lib/lessonspace/session-access";
import {
  joinStampAssignments,
  pairCompletesOnThisWrite,
  toDate,
  type JoinStampTimestamps,
} from "./join-stamp";

/**
 * The scheduled classroom's read and its one write (SPEC §7.7, §4.3).
 *
 * The sibling of `db/queries/sessions.ts`, which does the same job for the
 * instant/Agora path. Both take an already-authorized user id from the caller's
 * session, and both are server-side only: `started_at` is the clock the
 * completion cron measures against, so nothing about it may originate in a
 * browser.
 *
 * **The first-join rule itself is not defined here.** It lives in
 * `./join-stamp`, imported by this file and by `sessions.ts` alike — one
 * definition of `started_at`, two statements that use it. See that file.
 */

/** The booking behind a classroom, plus both display names, in one trip. */
export interface ClassroomBookingRow extends LessonSpaceBookingRow {
  /** Already resolved through the same fallbacks `getSessionRoomView` uses. */
  studentName: string;
  tutorName: string;
  /** Heading on `/classroom/[bookingId]`. Null when the booking has no subject. */
  subjectName: string | null;
  /** Shown beside the other party's name, as on the instant room. */
  durationMinutes: number | null;
}

/**
 * The booking a classroom join is about. Participant-agnostic — the caller runs
 * `checkLessonSpaceAccess` on the result, which is what decides.
 *
 * Both names come back because the LessonSpace launch payload needs the
 * **caller's** display name (§7.7 step 3) and which party that is isn't known
 * until the access check has run. Reading both in this trip avoids a second
 * round trip to fetch a name we already had a join away.
 *
 * **One read serves the route and the page**, unlike `db/queries/sessions.ts`,
 * which has a narrow `getSessionBooking` for `/api/agora/token` and a wide
 * `getSessionRoomView` for `/session/[bookingId]`. That pair exists because the
 * view resolves participation and viewer-relative labels the route does not
 * want; here the two callers need the *same* row — `checkLessonSpaceAccess`
 * decides for both, and both then pick a name off it with `access.isTutor`.
 * Part 2 added `subject_name` and `duration_minutes` for the page's heading; a
 * second near-identical query would have been two places to keep in step for the
 * sake of two columns the join route simply ignores.
 */
export async function getClassroomBooking(
  bookingId: string,
): Promise<ClassroomBookingRow | null> {
  const student = aliasedTable(profiles, "student_p");
  const tutor = aliasedTable(profiles, "tutor_p");

  const [row] = await db
    .select({
      id: bookings.id,
      studentId: bookings.studentId,
      tutorId: bookings.tutorId,
      status: bookings.status,
      type: bookings.type,
      // The join window is computed from these two (§7.3, §7.7 step 1).
      scheduledStartAt: bookings.scheduledStartAt,
      scheduledEndAt: bookings.scheduledEndAt,
      durationMinutes: bookings.durationMinutes,
      subjectName: subjects.name,
      studentName: student.displayName,
      studentFullName: student.fullName,
      tutorName: tutor.displayName,
      tutorFullName: tutor.fullName,
    })
    .from(bookings)
    .leftJoin(subjects, eq(subjects.id, bookings.subjectId))
    .innerJoin(student, eq(student.id, bookings.studentId))
    .innerJoin(tutor, eq(tutor.id, bookings.tutorId))
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!row) return null;
  return {
    id: row.id,
    studentId: row.studentId,
    tutorId: row.tutorId,
    status: row.status,
    type: row.type,
    scheduledStartAt: row.scheduledStartAt,
    scheduledEndAt: row.scheduledEndAt,
    durationMinutes: row.durationMinutes,
    subjectName: row.subjectName,
    // Same fallback chain as `getSessionRoomView`: a participant always has a
    // label to show the other side, even with an empty profile.
    studentName: row.studentName ?? row.studentFullName ?? "Student",
    tutorName: row.tutorName ?? row.tutorFullName ?? "Tutor",
  };
}

export interface ScheduledJoinStamp extends JoinStampTimestamps {
  lessonspaceRoomId: string | null;
  /** `confirmed` until this write completes the pair, `in_progress` after. */
  status: string;
}

/**
 * Record a participant's arrival in the scheduled classroom, idempotently
 * (SPEC §7.7 steps 2 and 4).
 *
 * **One statement, no CTE** — the same shape, and the same reasoning, as
 * `stampSessionJoin`. The `*_joined_at` / `started_at` decision is the *shared*
 * fragment from `./join-stamp`, so this path and the instant path cannot drift
 * about when a session starts. What this statement adds on top of it:
 *
 *  - `lessonspace_room_id` — persisted **only when null** (§7.7 step 2). The
 *    launch call is idempotent on the booking id, so it returns the same space
 *    every time; coalescing means the id is written once and never replaced.
 *    A second value mid-session would put the two participants in different
 *    rooms — the same hazard `agora_channel`'s backfill guards against.
 *  - `status` — `confirmed → in_progress` on the write that completes the pair,
 *    and **only** then. It reuses {@link pairCompletesOnThisWrite}, the very
 *    predicate that decides `started_at`, so the two can never disagree: a
 *    booking is `in_progress` exactly when it has a `started_at`, by
 *    construction rather than by two conditions that happen to match today.
 *    Postgres evaluates both `SET` expressions against the same pre-write row.
 *
 * **This is why the shipped instant statement was not widened to take a status
 * parameter.** Scheduled bookings are created `confirmed` (§7.3, `createScheduledBooking`)
 * and only reach `in_progress` here; instant bookings are inserted `in_progress`
 * by the accept transaction (§7.4) and their join write must never touch
 * `status` at all. Threading a status write through one statement would have put
 * a branch that does not apply to the instant path inside the instant path. See
 * docs/DECISIONS.md, Phase 7 Part 1.
 *
 * The WHERE re-checks type, state and participation even though
 * `checkLessonSpaceAccess` already did: that guard ran against a row read a
 * moment earlier, and this is the statement that actually changes something.
 *
 * **`b.type = 'scheduled'` is not decoration.** It makes this statement's row
 * set disjoint from `stampSessionJoin`'s by construction — this one is
 * *incapable* of writing to an instant booking even if it were miscalled with an
 * instant id, rather than relying on every present and future caller to check
 * first.
 *
 * The join window (§7.3) is deliberately **not** in this WHERE: it is a pure,
 * unit-tested decision in `lib/lessonspace/session-access.ts` evaluated against
 * the server's clock before we ever talk to LessonSpace. Duplicating it in SQL
 * would be a second definition of the window — the exact mistake this file's
 * shared fragment exists to avoid.
 *
 * Returns null when nothing matched — the row moved between the guard and the
 * write. The caller reads that as "no longer joinable".
 */
export async function stampScheduledSessionJoin(
  bookingId: string,
  userId: string,
  roomId: string,
): Promise<ScheduledJoinStamp | null> {
  // `string | Date` rather than `Date`: this generic is an assertion about
  // untyped driver output, and the raw path yields text. Claiming the weaker
  // shape is what makes `toDate` the thing that decides, instead of a cast that
  // silently disagrees with runtime.
  const rows = await db.execute<{
    lessonspace_room_id: string | null;
    student_joined_at: string | Date | null;
    tutor_joined_at: string | Date | null;
    started_at: string | Date | null;
    status: string;
  }>(sql`
    update bookings b
       set lessonspace_room_id = coalesce(b.lessonspace_room_id, ${roomId}),
           ${joinStampAssignments(userId)},
           status              = case
                                   when ${pairCompletesOnThisWrite(userId)}
                                   then 'in_progress'::booking_status
                                   else b.status
                                 end,
           updated_at          = now()
     where b.id = ${bookingId}
       and b.type = 'scheduled'
       and b.status in ('confirmed', 'in_progress')
       and (b.student_id = ${userId} or b.tutor_id = ${userId})
    returning b.lessonspace_room_id, b.student_joined_at, b.tutor_joined_at,
              b.started_at, b.status
  `);

  const row = rows[0];
  if (!row) return null;
  return {
    lessonspaceRoomId: row.lessonspace_room_id,
    studentJoinedAt: toDate(row.student_joined_at),
    tutorJoinedAt: toDate(row.tutor_joined_at),
    startedAt: toDate(row.started_at),
    status: row.status,
  };
}
