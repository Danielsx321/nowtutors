import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

/**
 * The tutor side when the SUBSCRIPTION is what fails (SPEC §8).
 *
 * **What the deployed instrumentation established, which this file pins down.**
 * Once a channel reaches `SUBSCRIBED` the whole chain works — INSERT callback,
 * guarded read-back, queue, modal. The fault was one step earlier: on some page
 * loads `.subscribe()`'s callback resolved `TIMED_OUT`, and on others it never
 * fired at all, and **nothing retried**. A failed subscribe was permanent for
 * that page's lifetime and completely invisible — the tutor still showed as
 * live and simply never received anything. Supabase's Realtime tenant sleeps on
 * the free tier and cold-starting it outlasts the client's connect timeout, so
 * the first tutor to arrive after a quiet period is the one who loses.
 *
 * Three properties are asserted here, and none of them is visible to
 * `incoming-requests.test.tsx`, which fakes a channel that always succeeds:
 *  1. a `TIMED_OUT` subscribe is retried, on a backoff, after the dead channel
 *     has been removed;
 *  2. a retry that succeeds delivers requests normally — the fix restores the
 *     chain rather than merely stopping the error;
 *  3. a request already waiting is surfaced by the MOUNT-TIME READ with no
 *     Realtime event of any kind, which is what makes a missed event
 *     self-healing on refresh.
 *
 * The fake channel here is deliberately inert: it records the status callback
 * instead of invoking it, so each test drives the connect outcome itself and a
 * callback that is never called is a state the test can actually reach.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
}));

const getIncomingRequest = vi.fn();
const listPendingIncomingRequests = vi.fn();
vi.mock("@/actions/session-requests", () => ({
  getIncomingRequest: (id: string) => getIncomingRequest(id),
  acceptSessionRequest: vi.fn(),
  declineSessionRequest: vi.fn(),
  listPendingIncomingRequests: () => listPendingIncomingRequests(),
}));

type Payload = { new: Record<string, unknown> };
type StatusCallback = (status: string, err?: Error) => void;

interface FakeChannel {
  topic: string;
  handlers: Map<string, (payload: Payload) => void>;
  /** Held, not called — the test decides what this connect did. */
  status: StatusCallback | null;
  removed: boolean;
  on(
    type: string,
    opts: { event: string },
    cb: (payload: Payload) => void,
  ): FakeChannel;
  subscribe(cb: StatusCallback): FakeChannel;
}

/** Every channel ever opened, in order. Length IS the attempt count. */
const channels: FakeChannel[] = [];
const removeChannel = vi.fn((channel: FakeChannel) => {
  channel.removed = true;
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: (topic: string) => {
      const channel: FakeChannel = {
        topic,
        handlers: new Map(),
        status: null,
        removed: false,
        on(_type, opts, cb) {
          channel.handlers.set(opts.event, cb);
          return channel;
        },
        subscribe(cb) {
          channel.status = cb;
          return channel;
        },
      };
      channels.push(channel);
      return channel;
    },
    removeChannel,
  }),
}));

import { IncomingRequests, mergeIntoQueue } from "@/components/features/tutor/incoming-requests";

const TUTOR_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const TTL_SECONDS = 60;
const NOW = new Date("2026-08-25T12:00:00.000Z");

/** The hook's first backoff step, and its watchdog — mirrored from the hook. */
const FIRST_BACKOFF_MS = 1_000;
const WATCHDOG_MS = 15_000;

function requestRow(id: string, studentName: string) {
  return {
    id,
    studentName,
    studentAvatarUrl: null,
    subjectName: "Mathematics",
    message: null,
    durationMinutes: 30,
    priceCredits: 250,
    expiresAt: new Date(NOW.getTime() + TTL_SECONDS * 1000).toISOString(),
    status: "pending",
  };
}

const latest = () => channels[channels.length - 1];

async function settle() {
  await act(async () => {});
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Report a subscribe outcome on the most recent channel. */
async function reportStatus(status: string) {
  await act(async () => {
    latest().status?.(status);
  });
}

async function deliverInsert(channel: FakeChannel, id: string) {
  await act(async () => {
    channel.handlers.get("INSERT")?.({
      new: { id, status: "pending", tutor_id: TUTOR_ID },
    });
  });
}

function renderShell() {
  return render(<IncomingRequests tutorId={TUTOR_ID} ttlSeconds={TTL_SECONDS} />);
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  channels.length = 0;
  removeChannel.mockClear();
  getIncomingRequest.mockReset();
  listPendingIncomingRequests.mockReset();
  listPendingIncomingRequests.mockResolvedValue({ ok: true, requests: [] });
  push.mockReset();
});

afterEach(() => {
  // Unmount before the real clock comes back — same reason as
  // `incoming-requests.test.tsx`: teardown clears timer ids the fake timers
  // issued, and the retry backoff is one of them.
  cleanup();
  vi.useRealTimers();
});

describe("subscription establishment", () => {
  it("retries a TIMED_OUT subscribe, removing the dead channel first", async () => {
    renderShell();
    await settle();
    expect(channels).toHaveLength(1);
    const first = channels[0];

    await reportStatus("TIMED_OUT");

    // The dead channel is released BEFORE the backoff, not left holding a
    // socket for the length of the wait — ten failures must cost one socket.
    expect(removeChannel).toHaveBeenCalledTimes(1);
    expect(first.removed).toBe(true);

    // And it backs off rather than hammering: nothing reconnects in the same tick.
    expect(channels).toHaveLength(1);

    await advance(FIRST_BACKOFF_MS);
    expect(channels).toHaveLength(2);
    expect(channels[1].topic).toBe(first.topic);
    expect(channels[1].handlers.has("INSERT")).toBe(true);
  });

  it("retries when the status callback never fires at all", async () => {
    // The other half of what was observed live, and the reason the retry cannot
    // hang off the status callback alone: a connect that simply hangs reports
    // nothing, so there is no status to react to.
    renderShell();
    await settle();
    expect(channels).toHaveLength(1);
    expect(latest().status).not.toBeNull();

    // Well short of the watchdog: a slow connect is still a connect.
    await advance(WATCHDOG_MS - 1_000);
    expect(channels).toHaveLength(1);
    expect(screen.queryByRole("status")).toBeNull();

    await advance(1_000 + FIRST_BACKOFF_MS);
    expect(channels).toHaveLength(2);
  });

  it("backs off between attempts instead of hammering", async () => {
    renderShell();
    await settle();

    await reportStatus("CHANNEL_ERROR");
    await advance(FIRST_BACKOFF_MS);
    expect(channels).toHaveLength(2);

    // Second failure waits longer than the first — and in particular the second
    // attempt has NOT been made a second-backoff early.
    await reportStatus("CHANNEL_ERROR");
    await advance(FIRST_BACKOFF_MS);
    expect(channels).toHaveLength(2);
    await advance(FIRST_BACKOFF_MS);
    expect(channels).toHaveLength(3);
  });

  it("does not retry after unmount, including mid-backoff", async () => {
    const { unmount } = renderShell();
    await settle();
    await reportStatus("TIMED_OUT");
    expect(channels).toHaveLength(1);

    // Unmount while the retry timer is still pending.
    unmount();
    await advance(FIRST_BACKOFF_MS * 10);
    expect(channels).toHaveLength(1);

    // And CLOSED — which is what an unmount produces — is never retried.
    await reportStatus("CLOSED");
    await advance(FIRST_BACKOFF_MS * 10);
    expect(channels).toHaveLength(1);
  });

  it("tells the tutor once a connect has failed, and not before", async () => {
    renderShell();
    await settle();

    // Quiet during the first attempt: a warning on every page load is a warning
    // people learn to ignore.
    expect(screen.queryByRole("status")).toBeNull();

    await reportStatus("TIMED_OUT");
    const indicator = screen.getByRole("status");
    expect(indicator.textContent).toContain("Reconnecting to instant requests");

    await advance(FIRST_BACKOFF_MS);
    await reportStatus("SUBSCRIBED");
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("a retry that succeeds", () => {
  it("delivers a request on the retried channel", async () => {
    getIncomingRequest.mockResolvedValue({
      ok: true,
      request: requestRow(REQUEST_ID, "Ada"),
    });

    renderShell();
    await settle();
    await reportStatus("TIMED_OUT");
    await advance(FIRST_BACKOFF_MS);
    await reportStatus("SUBSCRIBED");

    const retried = channels[1];
    await deliverInsert(retried, REQUEST_ID);

    // The point of retrying at all: the chain works again, on the new channel.
    expect(screen.getByRole("dialog")).not.toBeNull();
    expect(screen.getByText(/Ada wants to start now/)).not.toBeNull();
    // `hidden: true` because an open Radix dialog `aria-hidden`s everything
    // outside it — the indicator is still in the document, so a plain query
    // would report "absent" for a node that is merely behind a modal, and this
    // assertion would pass whether or not the indicator had gone.
    expect(screen.queryByRole("status", { hidden: true })).toBeNull();
  });

  it("re-reads what is already waiting after every successful subscribe", async () => {
    // The connect window is a hole a retry alone cannot close: a request that
    // arrived while the channel was down was never going to be delivered by the
    // channel that comes up afterwards.
    renderShell();
    await settle();
    expect(listPendingIncomingRequests).toHaveBeenCalledTimes(1); // mount

    listPendingIncomingRequests.mockResolvedValue({
      ok: true,
      requests: [requestRow(REQUEST_ID, "Grace")],
    });

    await reportStatus("TIMED_OUT");
    await advance(FIRST_BACKOFF_MS);
    await reportStatus("SUBSCRIBED");
    await settle();

    expect(listPendingIncomingRequests).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Grace wants to start now/)).not.toBeNull();
    expect(getIncomingRequest).not.toHaveBeenCalled();
  });
});

describe("the mount-time read", () => {
  it("surfaces a pending request with no Realtime event at all", async () => {
    // The refresh case, which is what a tutor actually tries. Before this read
    // existed the tutor side had no mount-time query whatsoever, so refreshing
    // re-subscribed and asked nothing — a request that had already arrived
    // stayed invisible however many times the page was reloaded.
    listPendingIncomingRequests.mockResolvedValue({
      ok: true,
      requests: [requestRow(REQUEST_ID, "Ada")],
    });

    renderShell();
    await settle();

    expect(screen.getByRole("dialog")).not.toBeNull();
    expect(screen.getByText(/Ada wants to start now/)).not.toBeNull();
    // Seeded from the row's own deadline, not from a fresh TTL.
    expect(screen.getByRole("timer").textContent).toContain("60");

    // Nothing subscribed, nothing was delivered, nothing was read back by id.
    expect(latest().status).not.toBeNull();
    expect(getIncomingRequest).not.toHaveBeenCalled();
  });

  it("runs even when the subscription never establishes", async () => {
    listPendingIncomingRequests.mockResolvedValue({
      ok: true,
      requests: [requestRow(REQUEST_ID, "Ada")],
    });

    renderShell();
    await settle();
    await reportStatus("CHANNEL_ERROR");
    await settle();

    // Both true at once, which is the honest state: the tutor can answer this
    // request, and the shell says the channel is not up.
    expect(screen.getByRole("dialog")).not.toBeNull();
    // Behind the open dialog, hence `hidden: true` — see above.
    expect(screen.getByRole("status", { hidden: true })).not.toBeNull();
  });

  it("shows nothing when nothing is waiting", async () => {
    renderShell();
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("mergeIntoQueue", () => {
  // The dedup rule the two producers depend on. Asserted here rather than
  // through the DOM because only `queue[0]` renders and `drop` filters by id,
  // so a double-add cannot be seen from the outside — an assertion made
  // through the modal would pass either way.
  const a = requestRow(REQUEST_ID, "Ada");
  const b = requestRow(OTHER_REQUEST_ID, "Grace");

  it("does not add a request the queue already holds", () => {
    expect(mergeIntoQueue([a], [a])).toEqual([a]);
    expect(mergeIntoQueue([a], [{ ...a, studentName: "Someone else" }])).toEqual([a]);
  });

  it("returns the same array when there is nothing to add", () => {
    const queue = [a];
    // Identity, not just equality: a new array would re-render the modal and
    // re-seed the countdown ring mid-answer.
    expect(mergeIntoQueue(queue, [a])).toBe(queue);
    expect(mergeIntoQueue(queue, [])).toBe(queue);
  });

  it("appends genuinely new requests, oldest first", () => {
    expect(mergeIntoQueue([a], [a, b])).toEqual([a, b]);
    expect(mergeIntoQueue([], [a, b])).toEqual([a, b]);
  });
});
