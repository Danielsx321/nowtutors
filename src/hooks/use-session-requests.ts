"use client";

import * as React from "react";
import {
  useRetryingChannel,
  type BrowserClient,
  type RealtimeStatus,
} from "@/hooks/use-retrying-channel";

export type { RealtimeStatus };

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

/** The row shape Realtime delivers (REPLICA IDENTITY FULL, drizzle/0006). */
interface SessionRequestPayloadRow {
  id?: string;
  status?: string;
  booking_id?: string | null;
  tutor_id?: string;
  student_id?: string;
}

export interface IncomingRequestHandlers {
  onIncoming: (requestId: string) => void;
  onSettled: (requestId: string, status: string) => void;
  /**
   * Called after every successful (re)subscribe, including the first.
   *
   * A subscription only carries what happens AFTER it is bound, so the window
   * between a page starting to load and its channel being established delivers
   * nothing — and on a retry that window is however long the backoff ran. The
   * caller closes it with a read; this is the hook telling it when to.
   */
  onSubscribed?: () => void;
}

/**
 * TUTOR side — an INSERT for me is a new incoming request; an UPDATE tells me a
 * request I may be showing has left `pending` (it expired, or the student
 * cancelled), so the modal can close instead of counting down to a dead row.
 *
 * Returns the subscription's {@link RealtimeStatus} so the tutor shell can say
 * so when it is not established. "You are live but not receiving requests" was
 * previously visible only in the console.
 */
export function useIncomingSessionRequests(
  tutorId: string,
  handlers: IncomingRequestHandlers,
): RealtimeStatus {
  const ref = React.useRef(handlers);
  ref.current = handlers;

  const build = React.useCallback(
    (supabase: BrowserClient) =>
      supabase
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
            if (row?.id && row.status === "pending") {
              ref.current.onIncoming(row.id);
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
            const row = payload.new as SessionRequestPayloadRow;
            if (row?.id && row.status && row.status !== "pending") {
              ref.current.onSettled(row.id, row.status);
            }
          },
        ),
    [tutorId],
  );

  const onSubscribed = React.useCallback(() => {
    ref.current.onSubscribed?.();
  }, []);

  return useRetryingChannel(
    tutorId ? `session-requests:tutor:${tutorId}` : null,
    build,
    onSubscribed,
  );
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
 *
 * Subscribed through the same retrying helper as the tutor side: a student
 * whose channel never established watches a ring run out on a request the tutor
 * may well have accepted, which is the identical fault on the other leg. The
 * status is not returned here — a student's request lives 60 seconds and the
 * waiting modal already has its own expiry message, so there is nothing honest
 * for a "reconnecting" indicator to add inside that window.
 */
export function useOutgoingSessionRequest(
  requestId: string | null,
): OutgoingRequestState | null {
  const [state, setState] = React.useState<OutgoingRequestState | null>(null);

  React.useEffect(() => {
    setState(null);
  }, [requestId]);

  const build = React.useCallback(
    (supabase: BrowserClient) =>
      supabase.channel(`session-request:${requestId}`).on(
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
      ),
    [requestId],
  );

  useRetryingChannel(requestId ? `session-request:${requestId}` : null, build);

  return state;
}
