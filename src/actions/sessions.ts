"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import {
  endElapsedInstantSession,
  endInstantSessionByParticipant,
  getSessionBooking,
} from "@/db/queries/sessions";
import { hasElapsed, msRemaining, sessionDeadline } from "@/lib/sessions/deadline";

/**
 * Ending an instant session, and reading how long is left (SPEC §7.4).
 *
 * Both actions re-check identity and participation server-side, independently of
 * the `(session)` layout guard (§5 Layer 2, CLAUDE.md: "Do not rely on the client
 * hiding a button"), and both return a **typed result** rather than throwing.
 * `requireUser()` rather than `requireRole()`, because the session room is the
 * one authenticated area both roles enter.
 *
 * **A missing booking and somebody else's booking give the identical answer** —
 * the same rule Part 3A applied to the token route and the room page, so neither
 * of these can be used to discover which booking ids are real.
 *
 * **Neither action touches the ledger.** Credits were charged once at accept
 * (§7.4 Billing); nothing here refunds, prorates or releases anything, and there
 * is no metering to stop. Neither writes `is_live` either: §7.5 makes ending a
 * session leaving presence alone an explicit non-behaviour, because a tutor who
 * finishes one session is usually available for the next.
 */

const bookingIdSchema = z.string().uuid();

export type EndSessionResult =
  | {
      ok: true;
      /**
       * False when the booking was already closed, or never started at all.
       * The caller must not present this as a failure — see the note on
       * `started_at` below.
       */
      transitioned: boolean;
      /** ISO-8601, null when nothing has been written yet. */
      endedAt: string | null;
      status: string;
    }
  | { error: string };

export interface SessionState {
  status: string;
  /** ISO-8601 "first moment both were present", or null. */
  startedAt: string | null;
  /** ISO-8601 hard stop, or null while the session has not started. */
  deadline: string | null;
  endedAt: string | null;
  /** Server-computed, so a skewed browser clock can correct itself. */
  msRemaining: number | null;
  /** The session is over: either transitioned, or past its deadline. */
  finished: boolean;
}

export type SessionStateResult = { ok: true; state: SessionState } | { error: string };

/** The one answer a caller who is not in this session ever gets. */
const NOT_FOUND = "Session not found." as const;

/**
 * Either participant ends the session (SPEC §7.4).
 *
 * **No refund, no proration, no grace period**, for either party. A student who
 * leaves after five minutes of a paid sixty-minute session gets nothing back, and
 * neither does anyone when the tutor ends it. That is Bubble's behaviour and this
 * rebuild's deliberate rule, not an oversight — which is why the confirm copy in
 * the UI says so plainly instead of reassuring.
 *
 * `transitioned: false` is a **success**, not an error, and covers two cases the
 * caller must not conflate with failure:
 *
 *  - the booking was already `completed` — the other party got there first, or
 *    the deadline actor did. The room is closed, which is what the caller wanted.
 *  - `started_at` is null, so the pair never completed and there is nothing to
 *    end. Part 3C classifies these as `no_show_*` from `*_joined_at` (§12);
 *    completing one here would have Part 3C pay a tutor who was never in the room
 *    while §7.4 forbids refunding the student. The UI must not imply the student
 *    is getting anything back — because they are not.
 */
export async function endSession(bookingId: string): Promise<EndSessionResult> {
  const user = await requireUser();

  const parsed = bookingIdSchema.safeParse(bookingId);
  // A malformed id is answered exactly like a real one belonging to someone
  // else: no shape of input tells the caller anything about what exists.
  if (!parsed.success) return { error: NOT_FOUND };

  const booking = await getSessionBooking(parsed.data);
  const isParticipant =
    booking != null &&
    (booking.studentId === user.id || booking.tutorId === user.id);
  if (!booking || !isParticipant) return { error: NOT_FOUND };
  if (booking.type !== "instant") {
    return { error: "This booking doesn't use the instant session room." };
  }

  // The read above chose which answer this caller is entitled to. The write
  // re-checks participation on its own, because the row can move in between and
  // the statement is the thing that actually changes something.
  const ended = await endInstantSessionByParticipant(parsed.data, user.id);

  revalidatePath(`/session/${parsed.data}`);
  revalidatePath("/dashboard/bookings");
  revalidatePath("/tutor/bookings");

  if (!ended) {
    // Re-read rather than guess which of the two no-op cases applied: the row
    // may have been closed by the other party between the two statements.
    const after = await getSessionBooking(parsed.data);
    return {
      ok: true,
      transitioned: false,
      endedAt: null,
      status: after?.status ?? booking.status,
    };
  }

  return {
    ok: true,
    transitioned: true,
    endedAt: ended.endedAt?.toISOString() ?? null,
    status: "completed",
  };
}

/**
 * How long is left, and — **at the deadline — the actor that stops the session**.
 *
 * This is the enforcement path that fires in the common case: both people in the
 * room when the booked time runs out. The token route only re-runs on a join or
 * a renewal, so for a 30- or 60-minute session it fires once, before the deadline;
 * something has to act *at* the deadline, and this is it.
 *
 * **The client never decides.** It calls this on mount, when the Agora SDK tells
 * it the other party arrived (so a `started_at` written after the page rendered
 * is picked up), and once when its cosmetic countdown reaches zero. Those are
 * three event-driven calls, not a poll — CLAUDE.md forbids `setInterval` polling
 * and there is none here. The decision itself is made twice on the server: by
 * {@link hasElapsed} to decide whether to *attempt* the transition, and then by
 * the statement's own `now() `-based predicate, which is what actually authorizes
 * it. A browser clock running fast matches zero rows and gets the true remaining
 * time back instead, so it cannot end a paid session early.
 */
export async function getSessionState(
  bookingId: string,
): Promise<SessionStateResult> {
  const user = await requireUser();

  const parsed = bookingIdSchema.safeParse(bookingId);
  if (!parsed.success) return { error: NOT_FOUND };

  let booking = await getSessionBooking(parsed.data);
  const isParticipant =
    booking != null &&
    (booking.studentId === user.id || booking.tutorId === user.id);
  if (!booking || !isParticipant) return { error: NOT_FOUND };

  const now = new Date();
  let endedAt: Date | null = null;

  if (booking.status === "in_progress" && hasElapsed(booking, now)) {
    const ended = await endElapsedInstantSession(parsed.data);
    if (ended) {
      endedAt = ended.endedAt;
      booking = { ...booking, status: "completed" };
      revalidatePath(`/session/${parsed.data}`);
    } else {
      // Zero rows: either somebody else closed it in the same instant, or
      // Postgres disagrees that the deadline has passed (a skewed app-server
      // clock, which is exactly why the predicate is in SQL). Re-read and
      // report what the database actually says rather than what we assumed.
      booking = (await getSessionBooking(parsed.data)) ?? booking;
    }
  }

  const deadline = sessionDeadline(booking);
  const finished = booking.status !== "in_progress" || hasElapsed(booking, now);

  return {
    ok: true,
    state: {
      status: booking.status,
      startedAt: booking.startedAt?.toISOString() ?? null,
      deadline: deadline?.toISOString() ?? null,
      endedAt: endedAt?.toISOString() ?? null,
      msRemaining: msRemaining(booking, now),
      finished,
    },
  };
}
