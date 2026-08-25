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
          const row = payload.new as SessionRequestPayloadRow;
          if (row?.id && row.status === "pending") ref.current.onIncoming(row.id);
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
          const row = payload.new as SessionRequestPayloadRow;
          if (row?.id && row.status && row.status !== "pending") {
            ref.current.onSettled(row.id, row.status);
          }
        },
      )
      .subscribe((status, err) => {
        reportSubscriptionStatus(`session-requests:tutor:${tutorId}`, status, err);
      });

    return () => {
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
