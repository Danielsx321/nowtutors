/**
 * Who may join a scheduled booking's LessonSpace classroom, and as what
 * (SPEC §7.7 step 1, §7.3, §5).
 *
 * Pure and `server-only`-free — the exact sibling of `lib/agora/session-access.ts`
 * and for the same reason: the route file that consumes this pulls in
 * `server-only` transitively and cannot be imported by a unit test, while the
 * guarantees here are the ones that must never regress unnoticed —
 *
 *  1. **A non-participant cannot get a join link.** Not by RLS, which the trusted
 *     server connection bypasses, but by an explicit id comparison right here,
 *     checked first and unconditionally.
 *  2. **The role is derived server-side.** `teacher` for the tutor, `student`
 *     otherwise; there is no branch that reads a role off the request. The live
 *     Bubble app picks the leader flag in browser JavaScript by comparing profile
 *     ids — we do not (Finding A).
 *  3. **The join window is our own server-side gate**, enforced here (§7.7 step 1
 *     is explicit that LessonSpace is not asked to police time). A booking joined
 *     too early or too late yields no link, so a stale tab cannot reopen a
 *     classroom hours later.
 */

/** The `bookings` columns the classroom access check reads. */
export interface LessonSpaceBookingRow {
  id: string;
  studentId: string;
  tutorId: string;
  /** `booking_status` enum. Only `confirmed` / `in_progress` are joinable. */
  status: string;
  /** `booking_type` enum. Only `scheduled` uses the LessonSpace classroom (§6). */
  type: string;
  /** Window opens 10 min before this (§7.3). Null only for non-scheduled rows. */
  scheduledStartAt: Date | null;
  /** Window closes 30 min after this (§7.3). Null only for non-scheduled rows. */
  scheduledEndAt: Date | null;
}

/** LessonSpace's roles. The tutor leads; everyone else attends. */
export type LessonSpaceRole = "teacher" | "student";

export type LessonSpaceAccess =
  | {
      ok: true;
      bookingId: string;
      /** Server-derived. The tutor is the leader (§7.7 step 3, Finding A). */
      isTutor: boolean;
      role: LessonSpaceRole;
    }
  | {
      ok: false;
      status: number;
      message: string;
    };

/** Join opens this many minutes before `scheduled_start_at` (§7.3). */
export const JOIN_WINDOW_BEFORE_MINUTES = 10;
/** Join stays open this many minutes after `scheduled_end_at` (§7.3). */
export const JOIN_WINDOW_AFTER_MINUTES = 30;

const MS_PER_MINUTE = 60_000;

/** Just the timing columns the window is computed from. */
export type JoinWindowTiming = Pick<
  LessonSpaceBookingRow,
  "scheduledStartAt" | "scheduledEndAt"
>;

/**
 * Is `now` inside the join window for this booking?
 *
 * The window is `[scheduled_start_at − 10m, scheduled_end_at + 30m]`, spelled out
 * in SPEC §7.3 ("active 10 minutes before `scheduled_start_at` … until 30 minutes
 * after `scheduled_end_at`"). This is **our** rule, not LessonSpace's (§7.7 step
 * 1) — which is why `now` is an explicit parameter rather than read inside: the
 * window has to be checkable at pinned instants, and the authoritative clock is
 * the server's, never the browser's.
 *
 * **Both boundaries are inclusive.** Exactly at `start − 10m` the classroom is
 * open; exactly at `end + 30m` it is still open. `>=` / `<=`, chosen to match the
 * intuition that "opens at" and "stays open until" name moments that count, and
 * so the boundary case has one unambiguous answer a test can pin (see
 * DECISIONS, Phase 7 Part 1). One second past either edge is outside.
 *
 * Null timing yields false: a booking with no scheduled window (structurally,
 * a non-scheduled row) can never be inside one. That mirrors `sessionDeadline`
 * returning null rather than doing arithmetic on a null clock.
 */
export function withinJoinWindow(timing: JoinWindowTiming, now: Date): boolean {
  const { scheduledStartAt, scheduledEndAt } = timing;
  if (scheduledStartAt === null || scheduledEndAt === null) return false;

  const start = scheduledStartAt.getTime();
  const end = scheduledEndAt.getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return false;

  const opensAt = start - JOIN_WINDOW_BEFORE_MINUTES * MS_PER_MINUTE;
  const closesAt = end + JOIN_WINDOW_AFTER_MINUTES * MS_PER_MINUTE;
  const t = now.getTime();
  return t >= opensAt && t <= closesAt;
}

/**
 * Decide whether `userId` may join this booking's classroom, and as what.
 *
 * **A missing booking and someone else's booking return the same 404.** A 403
 * would confirm the booking exists, turning the endpoint into an oracle for
 * booking ids — the same choice `checkSessionAccess`, `checkDirectPayEligibility`
 * and `getBookingDetailForParticipant` already make. Participation is checked
 * **first and unconditionally**, so nothing below — not the booking's state, not
 * its schedule — can leak to a non-participant.
 *
 * The refusals below, in order:
 *
 *  - **not `scheduled`** → 400. Instant bookings are the Agora room (§7.4); they
 *    have no classroom. The inverse of `checkSessionAccess`'s instant-only check.
 *  - **not `confirmed` or `in_progress`** → 409 (§7.7 step 1). A scheduled
 *    booking is created `confirmed` and only becomes `in_progress` once both
 *    parties have joined (§7.3, §7.7 step 4), so `confirmed` is the normal state
 *    of the *first* arrival and must be admitted. `pending_payment` (PayPal not
 *    yet captured), `completed`, and every cancelled/no-show terminal state are
 *    refused.
 *  - **outside the join window** → 409 (§7.3, step 1). Distinct messages for too
 *    early vs. too late; same status, since neither leaks anything a participant
 *    isn't entitled to know.
 *
 * On admission the role is `teacher` for the tutor and `student` for the student
 * — derived here, never taken from the request.
 */
export function checkLessonSpaceAccess(
  row: LessonSpaceBookingRow | null | undefined,
  userId: string,
  now: Date = new Date(),
): LessonSpaceAccess {
  const isStudent = row?.studentId === userId;
  const isTutor = row?.tutorId === userId;
  if (!row || (!isStudent && !isTutor)) {
    return { ok: false, status: 404, message: "Session not found." };
  }
  if (row.type !== "scheduled") {
    // Instant bookings use the Agora session room (§7.4), not a classroom.
    return {
      ok: false,
      status: 400,
      message: "This booking doesn't use the scheduled classroom.",
    };
  }
  if (row.status !== "confirmed" && row.status !== "in_progress") {
    return {
      ok: false,
      status: 409,
      message: "This session isn't ready to join.",
    };
  }
  if (!withinJoinWindow(row, now)) {
    const tooEarly =
      row.scheduledStartAt !== null &&
      now.getTime() <
        row.scheduledStartAt.getTime() -
          JOIN_WINDOW_BEFORE_MINUTES * MS_PER_MINUTE;
    return {
      ok: false,
      status: 409,
      message: tooEarly
        ? "The classroom isn't open yet."
        : "The join window for this session has closed.",
    };
  }

  return {
    ok: true,
    bookingId: row.id,
    isTutor,
    role: isTutor ? "teacher" : "student",
  };
}
