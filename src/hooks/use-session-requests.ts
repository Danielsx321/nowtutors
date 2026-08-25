"use client";

import * as React from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeDiagnostic } from "@/hooks/use-realtime-diagnostic";

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
 * What a subscription is doing, as the UI needs to see it.
 *
 * `connecting` is the FIRST attempt only and is deliberately indistinguishable
 * from health to the tutor — a shell that flashes a warning on every page load
 * teaches people to ignore it. `unavailable` means at least one attempt has
 * already failed and a retry is scheduled; that is the state worth showing,
 * because it is the state in which a tutor reads as live and receives nothing.
 */
export type RealtimeStatus = "connecting" | "subscribed" | "unavailable";

/**
 * Backoff for re-subscribing. Bounded at both ends: it starts a second after
 * the first failure so a transient blip recovers quickly, and it never gets
 * slower than 30s, so a tutor who leaves the tab open through a long outage is
 * still connected within half a minute of the service coming back.
 *
 * The cap is on the DELAY, not on the number of attempts. A tutor sitting on
 * `/tutor` marked live has no other way to receive a request, so giving up
 * would only restore the silent failure this exists to remove — and at one
 * attempt per 30s this is two orders of magnitude off polling.
 */
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;

/**
 * How long to wait for `.subscribe()`'s callback before treating the connect as
 * failed even though nothing reported a failure.
 *
 * This is the case the deployed instrumentation actually caught: on some page
 * loads the callback resolved `TIMED_OUT`, and on others **it never fired at
 * all**. A retry hung off the status callback alone cannot see the second one,
 * so the retry cannot depend solely on that callback. 15s sits past the
 * realtime client's own 10s connect timeout, so a real `TIMED_OUT` is still
 * what gets reported when the client manages to report anything.
 */
const CONNECT_WATCHDOG_MS = 15_000;

/** Watchdog-fired: no status of any kind, which is not a status the client has. */
const NO_STATUS_CALLBACK = "NO_STATUS_CALLBACK";

/**
 * Report what the socket did with a subscription.
 *
 * `.subscribe()` took no callback until the countdown fix, which meant
 * `CHANNEL_ERROR`, `TIMED_OUT` and a binding the `session_requests` RLS SELECT
 * policy refuses were all indistinguishable — from here — from a channel that
 * simply had nothing to deliver.
 *
 * **`SUBSCRIBED` is logged too, and that is a change.** It used to return early
 * alongside `CLOSED`, on the reasoning that success is not news. It is: during
 * the instant-request investigation a console with no `[realtime/…]` line in it
 * meant either "the subscription is healthy" or "the subscribe callback never
 * ran", and those are the two opposite answers to the question being asked.
 * Health that says nothing cannot be told apart from silence. `CLOSED` stays
 * quiet because it is what unmounting produces on every navigation.
 */
function reportSubscriptionStatus(
  scope: string,
  status: string,
  err?: Error,
): void {
  if (status === "CLOSED") return;
  if (status === "SUBSCRIBED") {
    console.info(`[realtime/${scope}] subscription SUBSCRIBED`);
    return;
  }
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

type BrowserClient = ReturnType<typeof createClient>;

/**
 * Subscribe a channel and KEEP it subscribed (SPEC §8).
 *
 * **Why this exists, replacing "visibility only".** The previous fix logged a
 * failed subscribe and deliberately did nothing about it, on the reasoning that
 * Realtime reconnects on its own and a client-side retry would be the polling
 * CLAUDE.md forbids wearing a different hat. The deployed instrumentation run
 * falsified the first half of that: when the subscription establishes the whole
 * chain works, and when it does not, **nothing ever retries** — the failure is
 * permanent for that page's lifetime and invisible, because the tutor still
 * reads as live. Supabase's Realtime tenant sleeps on the free tier ("Stop
 * tenant because of no connected users") and cold-starting it does real work
 * that outlasts the client's connect timeout, so the first tutor to arrive
 * after a quiet period is the one who loses.
 *
 * This is not polling and the distinction is not a technicality: it retries
 * only while it is NOT connected, it stops the moment it is, and it makes no
 * request for data at any point — it is establishing the push channel that
 * exists so nothing has to poll.
 *
 * Three things it has to get right, all of them the reason it is one helper
 * rather than repeated per hook:
 *  - **The previous channel is removed before every retry**, so a page that
 *    fails ten times holds one socket, not ten.
 *  - **The callback never firing is itself a failure.** A watchdog treats a
 *    hung connect as a failed one; without it the retry would only cover the
 *    statuses the client manages to report.
 *  - **`CLOSED` is not retried.** It is what unmounting produces, and the
 *    `disposed` flag means a teardown mid-backoff cancels the pending retry
 *    instead of resurrecting a channel for a component that is gone.
 */
function useRetryingChannel(
  /** Channel topic, and the log scope. `null` disables the subscription. */
  scope: string | null,
  build: (client: BrowserClient) => RealtimeChannel,
  onSubscribed?: () => void,
): RealtimeStatus {
  // Both callbacks live in refs: a re-render with new closures must not tear
  // down and re-establish the socket.
  const buildRef = React.useRef(build);
  buildRef.current = build;
  const subscribedRef = React.useRef(onSubscribed);
  subscribedRef.current = onSubscribed;

  const [status, setStatus] = React.useState<RealtimeStatus>("connecting");

  React.useEffect(() => {
    setStatus("connecting");
    if (!scope) return;
    // Narrowed once, so the closures below carry a `string` rather than each
    // re-asserting the guard above.
    const topic = scope;

    const supabase = createClient();
    let disposed = false;
    let channel: RealtimeChannel | null = null;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    function clearTimers() {
      if (watchdog !== null) {
        clearTimeout(watchdog);
        watchdog = null;
      }
      if (retry !== null) {
        clearTimeout(retry);
        retry = null;
      }
    }

    function dropChannel() {
      if (channel === null) return;
      const dead = channel;
      channel = null;
      void supabase.removeChannel(dead);
    }

    function fail(failedWith: string, err?: Error) {
      if (disposed) return;
      reportSubscriptionStatus(topic, failedWith, err);
      clearTimers();
      // Before the backoff, not after it — a channel we have given up on must
      // not hold its socket for the length of the wait.
      dropChannel();
      setStatus("unavailable");
      const delay = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
      attempt += 1;
      retry = setTimeout(() => {
        retry = null;
        connect();
      }, delay);
    }

    function connect() {
      if (disposed) return;
      dropChannel();
      // Assigned BEFORE `.subscribe()`, because `.subscribe()` can invoke its
      // callback synchronously — and a `fail()` that ran before the assignment
      // would leave the channel it is failing on unremovable.
      const opened = buildRef.current(supabase);
      channel = opened;
      // Armed BEFORE `.subscribe()`, because `.subscribe()` may invoke its
      // callback synchronously — a watchdog set afterwards would be set after
      // the `SUBSCRIBED` that was supposed to clear it, and would then fire on
      // a healthy channel and tear it down.
      watchdog = setTimeout(() => {
        watchdog = null;
        fail(NO_STATUS_CALLBACK);
      }, CONNECT_WATCHDOG_MS);
      opened.subscribe((next, err) => {
        if (disposed) return;
        if (next === "SUBSCRIBED") {
          reportSubscriptionStatus(topic, next);
          clearTimers();
          attempt = 0;
          setStatus("subscribed");
          subscribedRef.current?.();
          return;
        }
        // CLOSED is teardown, ours or the client's. Retrying it would fight
        // the unmount that caused it.
        if (next === "CLOSED") {
          reportSubscriptionStatus(topic, next);
          return;
        }
        fail(next, err);
      });
    }

    connect();

    return () => {
      disposed = true;
      clearTimers();
      dropChannel();
    };
  }, [scope]);

  return status;
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

  // Instrumentation, and inert unless `NEXT_PUBLIC_RT_DIAG === "1"` — with the
  // flag unset its effect returns on its first statement, so no client is
  // constructed and no socket is opened. It runs BESIDE the subscription
  // below on its own clients and feeds nothing back into it; deleting this one
  // line removes the diagnostic entirely. See `use-realtime-diagnostic.ts`.
  useRealtimeDiagnostic(tutorId);

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
