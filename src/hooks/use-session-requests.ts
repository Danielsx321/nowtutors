"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * The two `session_requests` Realtime subscriptions (SPEC §8), one per side of
 * the instant handshake. They replace the `has_live_request` polling the Bubble
 * app used — there is no `setInterval` here and no fetch loop; a change in the
 * table pushes.
 *
 * Both subscribe through the browser Supabase client, so the socket carries the
 * signed-in user's JWT and the `session_requests` RLS SELECT policy
 * (participants only, drizzle/0005) decides what rows can reach them. The
 * `filter` below is a narrowing convenience, **not** the authorization — RLS is.
 *
 * The payload is treated as a NOTIFICATION, not as data. It says "row X
 * changed"; anything shown to a person is then read back through a guarded
 * Server Action (`getIncomingRequest`). Status transitions are the one thing
 * read off the payload directly, because a status is not a display join and the
 * row is already RLS-scoped to this viewer.
 */

const TABLE = "session_requests";

/**
 * Report what the socket did with a subscription.
 *
 * `.subscribe()` took no callback until now, which meant `CHANNEL_ERROR`,
 * `TIMED_OUT` and a binding the `session_requests` RLS SELECT policy refuses
 * were all indistinguishable — from here — from a channel that simply had
 * nothing to deliver. A tutor whose subscription never established looked
 * exactly like a tutor nobody had requested, on the screen and in the logs
 * alike, and the first anyone knew of it was a student watching a ring run out.
 *
 * **Visibility only.** No retry, no fallback and no change to what the channel
 * does — Realtime reconnects on its own, and a client-side retry loop here
 * would be the polling CLAUDE.md forbids wearing a different hat. This says
 * out loud what already happened. `console.error` is the same shape the route
 * handlers use, and Sentry (§2) picks it up from the browser.
 */
function reportSubscriptionStatus(
  scope: string,
  status: string,
  err?: Error,
): void {
  if (status === "SUBSCRIBED" || status === "CLOSED") return;
  console.error(`[realtime/${scope}] subscription ${status}`, {
    status,
    error: err?.message ?? null,
  });
}

/* -------------------------------------------------------------------------
 * [ir-trace] TEMPORARY INSTRUMENTATION — REMOVE.
 *
 * Added on debug/incoming-requests-trace to make the tutor's never-painting
 * instant-request modal observable. The subscription reports SUBSCRIBED and
 * rows are written, so the fault is somewhere between a frame arriving and the
 * modal rendering. Every step of that chain now says out loud that it ran.
 *
 * Grep `[ir-trace]` to find and delete all of it. It changes no behaviour.
 * ------------------------------------------------------------------------- */
function irTrace(step: string, detail?: unknown): void {
  if (detail === undefined) console.log(`[ir-trace] ${step}`);
  else console.log(`[ir-trace] ${step}`, detail);
}

/** The row shape Realtime delivers (REPLICA IDENTITY FULL, drizzle/0006). */
interface SessionRequestPayloadRow {
  id?: string;
  status?: string;
  booking_id?: string | null;
  tutor_id?: string;
  student_id?: string;
}

/**
 * TUTOR side — an INSERT for me is a new incoming request; an UPDATE tells me a
 * request I may be showing has left `pending` (it expired, or the student
 * cancelled), so the modal can close instead of counting down to a dead row.
 */
export function useIncomingSessionRequests(
  tutorId: string,
  handlers: {
    onIncoming: (requestId: string) => void;
    onSettled: (requestId: string, status: string) => void;
  },
): void {
  // Keep the callbacks in a ref so a re-render with new closures does not tear
  // down and re-establish the socket subscription.
  const ref = React.useRef(handlers);
  ref.current = handlers;

  React.useEffect(() => {
    if (!tutorId) return;
    irTrace("hook: effect running, subscribing", { tutorId });
    const supabase = createClient();
    const channel = supabase
      .channel(`session-requests:tutor:${tutorId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: TABLE,
          filter: `tutor_id=eq.${tutorId}`,
        },
        (payload) => {
          // [ir-trace] 1 — the INSERT callback fired at all, and the whole row.
          irTrace("1. INSERT callback fired; payload.new =", payload.new);
          const row = payload.new as SessionRequestPayloadRow;
          irTrace("1b. row fields", {
            id: row?.id ?? null,
            status: row?.status ?? null,
            tutor_id: row?.tutor_id ?? null,
          });
          // [ir-trace] 2 — the status guard: what it saw and whether it passed.
          const id = row?.id;
          const passed = !!id && row.status === "pending";
          irTrace("2. status guard", {
            statusSeen: row?.status ?? null,
            hasId: !!id,
            passed,
          });
          if (id && passed) {
            irTrace("2b. calling onIncoming", id);
            ref.current.onIncoming(id);
          } else {
            irTrace("2b. GUARD REJECTED — onIncoming NOT called");
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: TABLE,
          filter: `tutor_id=eq.${tutorId}`,
        },
        (payload) => {
          // [ir-trace] UPDATEs drain the queue — an early/unexpected one would
          // close a modal that had only just opened, so log them too.
          irTrace("U. UPDATE callback fired; payload.new =", payload.new);
          const row = payload.new as SessionRequestPayloadRow;
          if (row?.id && row.status && row.status !== "pending") {
            irTrace("U2. calling onSettled", { id: row.id, status: row.status });
            ref.current.onSettled(row.id, row.status);
          } else {
            irTrace("U2. UPDATE ignored", { status: row?.status ?? null });
          }
        },
      )
      .subscribe((status, err) => {
        // [ir-trace] reportSubscriptionStatus is silent on SUBSCRIBED/CLOSED;
        // this says every status out loud so "silent" and "fine" are distinct.
        irTrace("0. subscribe status", { status, error: err?.message ?? null });
        reportSubscriptionStatus(`session-requests:tutor:${tutorId}`, status, err);
      });

    return () => {
      // [ir-trace] a teardown here means the channel went away — if this fires
      // right after subscribing, the effect is re-running and dropping frames.
      irTrace("0b. effect cleanup — removing channel", { tutorId });
      void supabase.removeChannel(channel);
    };
  }, [tutorId]);
}

/** Terminal states a student's waiting modal reacts to. */
export type OutgoingRequestStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "expired"
  | "cancelled"
  | "failed_payment";

export interface OutgoingRequestState {
  status: OutgoingRequestStatus;
  bookingId: string | null;
}

/**
 * STUDENT side — UPDATEs on my own request. `accepted` carries the
 * `booking_id` the waiting modal navigates to; the other four are each shown as
 * their own message, because "the tutor said no", "nobody answered" and "your
 * balance moved" are different things to have happened and collapsing them
 * would leave a student guessing (§7.4, §4.3).
 */
export function useOutgoingSessionRequest(
  requestId: string | null,
): OutgoingRequestState | null {
  const [state, setState] = React.useState<OutgoingRequestState | null>(null);

  React.useEffect(() => {
    setState(null);
    if (!requestId) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`session-request:${requestId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: TABLE,
          filter: `id=eq.${requestId}`,
        },
        (payload) => {
          const row = payload.new as SessionRequestPayloadRow;
          if (!row?.status) return;
          setState({
            status: row.status as OutgoingRequestStatus,
            bookingId: row.booking_id ?? null,
          });
        },
      )
      .subscribe((status, err) => {
        reportSubscriptionStatus(`session-request:${requestId}`, status, err);
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [requestId]);

  return state;
}
