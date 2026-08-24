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
 *     channel cannot be joined before the session starts or after it ends —
 *     including after its booked duration has run out, which is the server-side
 *     half of §7.4's hard stop (see {@link checkSessionAccess}).
 */

import { hasElapsed, type SessionTiming } from "@/lib/sessions/deadline";

/** The `bookings` columns the access check reads. */
export interface SessionBookingRow extends SessionTiming {
  id: string;
  studentId: string;
  tutorId: string;
  /** `booking_status` enum. Only `in_progress` is joinable. */
  status: string;
  /** `booking_type` enum. Only `instant` uses the Agora room (§6). */
  type: string;
  /** `session_{booking_id}`, written at accept. Backfilled on join if null. */
  agoraChannel: string | null;
  // `startedAt` and `durationMinutes` come from SessionTiming: together they are
  // the hard-stop deadline (§7.4), and refusing a credential past it is what
  // makes the stop hold against a client that ignores its own countdown.
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
  | {
      ok: false;
      status: number;
      message: string;
      /**
       * The refusal was the hard stop, not a missing or foreign booking. The
       * route uses this to close the booking out as well as refuse — but the
       * **refusal does not depend on that write succeeding**. Enforcement is
       * "no credential"; the transition is bookkeeping.
       *
       * Only ever set alongside a refusal the caller is already entitled to see,
       * so it leaks nothing: a non-participant is turned away by the 404 above
       * before this branch is reached.
       */
      elapsed?: boolean;
    };

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
 *
 * **An elapsed session is refused even while it is still `in_progress`** (§7.4).
 * That ordering is the point: the status flips to `completed` only when some
 * actor performs the transition, and this check must not wait for one. A client
 * that ignores its own countdown, opens a second tab, or reconnects after the
 * deadline is refused on the strength of `started_at` alone — and once the
 * renewal pass lands, the same check runs on every renewal, which is what makes
 * the room impossible to hold open past its booked duration.
 *
 * Participation is checked **first and unconditionally**, so an elapsed booking
 * belonging to somebody else still returns the same 404 as one that does not
 * exist. `elapsed` never rides on an answer a non-participant can see.
 */
export function checkSessionAccess(
  row: SessionBookingRow | null | undefined,
  userId: string,
  now: Date = new Date(),
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
  if (hasElapsed(row, now)) {
    return {
      ok: false,
      status: 409,
      message: "This session has ended — the booked time is up.",
      elapsed: true,
    };
  }

  return { ok: true, bookingId: row.id, isTutor, role: "publisher" };
}
