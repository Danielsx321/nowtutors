/**
 * Who may hold a token for a session channel, and as what (SPEC §9 step 2, §5).
 *
 * Pure and `server-only`-free, for the same reason `lib/paypal/direct-pay.ts` is:
 * the route file cannot be imported by a unit test (it pulls in `server-only`
 * transitively), and the three guarantees here are exactly the ones that must
 * never regress unnoticed —
 *
 *  1. **A non-participant cannot get a token.** Not by RLS, which the trusted
 *     server connection bypasses (docs/DECISIONS.md), but by an explicit id
 *     comparison right here.
 *  2. **The role is derived server-side.** It is not a field on the request and
 *     there is no branch in this file that reads one. The live Bubble app picks
 *     the role in browser JavaScript by comparing profile ids; we do not.
 *  3. **A booking that is not a live instant session yields no token**, so a
 *     channel cannot be joined before the session starts or after it ends.
 */

/** The `bookings` columns the access check reads. */
export interface SessionBookingRow {
  id: string;
  studentId: string;
  tutorId: string;
  /** `booking_status` enum. Only `in_progress` is joinable. */
  status: string;
  /** `booking_type` enum. Only `instant` uses the Agora room (§6). */
  type: string;
  /** `session_{booking_id}`, written at accept. Backfilled on join if null. */
  agoraChannel: string | null;
}

/** Agora's RTC token roles. */
export type AgoraRole = "publisher" | "subscriber";

export type SessionAccess =
  | {
      ok: true;
      bookingId: string;
      /** Server-derived. Drives which tracks the client publishes. */
      isTutor: boolean;
      role: AgoraRole;
    }
  | { ok: false; status: number; message: string };

/**
 * Decide whether `userId` may join this booking's channel.
 *
 * **A missing booking and someone else's booking return the same 404.** A 403
 * would confirm the booking exists, turning the endpoint into an oracle for
 * booking ids; the same choice `checkDirectPayEligibility` and
 * `getBookingDetailForParticipant` already make.
 *
 * **Both participants get `publisher`.** SPEC §9 step 2 specifies an
 * unconditional publisher role for a session, and the media split it describes —
 * tutor publishes camera + microphone, student publishes microphone only — is
 * enforced in the client wrapper, not by withholding publish rights in the token.
 * A `subscriber` token for the student would be a token that forbids the audio
 * the design requires them to send: it survives only while Agora's co-host
 * authentication is switched off for the project, which is a console setting
 * nothing in this repo guards. `isTutor` carries the asymmetry instead.
 */
export function checkSessionAccess(
  row: SessionBookingRow | null | undefined,
  userId: string,
): SessionAccess {
  const isStudent = row?.studentId === userId;
  const isTutor = row?.tutorId === userId;
  if (!row || (!isStudent && !isTutor)) {
    return { ok: false, status: 404, message: "Session not found." };
  }
  if (row.type !== "instant") {
    // Scheduled bookings are LessonSpace (§7.7, Phase 7) and have no channel.
    return {
      ok: false,
      status: 400,
      message: "This booking doesn't use the instant session room.",
    };
  }
  if (row.status !== "in_progress") {
    return { ok: false, status: 409, message: "This session isn't live." };
  }

  return { ok: true, bookingId: row.id, isTutor, role: "publisher" };
}
