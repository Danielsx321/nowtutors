import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * The incoming request as a call (design overhaul Part 4).
 *
 * Same harness as `incoming-requests.test.tsx` (the socket and the Server
 * Actions are the only fakes), plus `sonner`, so the missed-request notice can
 * be seen. Asserted: Accept has the focus when the call opens; the request is
 * announced once, not per tick; the ring running out leaves a notice that
 * stays; a request settled some other way leaves none; the sound choice
 * persists.
 */

const toast = vi.fn();

// jsdom here has no usable localStorage (opaque origin), so give it a tiny one.
const store = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
});
vi.mock("sonner", () => ({ toast: (...args: unknown[]) => toast(...args) }));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
}));

const getIncomingRequest = vi.fn();
const acceptSessionRequest = vi.fn();
const declineSessionRequest = vi.fn();
const listPendingIncomingRequests = vi.fn();
vi.mock("@/actions/session-requests", () => ({
  getIncomingRequest: (id: string) => getIncomingRequest(id),
  acceptSessionRequest: (id: string) => acceptSessionRequest(id),
  declineSessionRequest: (id: string) => declineSessionRequest(id),
  listPendingIncomingRequests: () => listPendingIncomingRequests(),
}));

/** The `postgres_changes` callbacks the hook registers, keyed by event. */
type Payload = { new: Record<string, unknown> };
const bound = new Map<string, (payload: Payload) => void>();
const removeChannel = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    // The hook attaches the session's JWT to the socket before it subscribes.
    // A signed-in session and a setAuth that resolves: the healthy path.
    auth: {
      getSession: async () => ({
        data: { session: { access_token: "test-access-token" } },
        error: null,
      }),
    },
    realtime: { setAuth: async () => {} },
    channel: () => {
      const channel = {
        on(
          _type: string,
          opts: { event: string },
          cb: (payload: Payload) => void,
        ) {
          bound.set(opts.event, cb);
          return channel;
        },
        subscribe(cb: (status: string) => void) {
          // Report SUBSCRIBED, as the real client does on a healthy connect.
          // The hook now retries anything that is not SUBSCRIBED and treats a
          // callback that never fires as a failure too, so a fake that stayed
          // silent would put every test in this file into a retry loop it is
          // not about. The failure paths are `realtime-resilience.test.tsx`.
          cb("SUBSCRIBED");
          return channel;
        },
      };
      return channel;
    },
    removeChannel,
  }),
}));

import { IncomingRequests } from "@/components/features/tutor/incoming-requests";

const TUTOR_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const TTL_SECONDS = 60;
/** A fixed wall clock, so "60 seconds from now" is an exact instant. */
const NOW = new Date("2026-08-25T12:00:00.000Z");

function pendingRequest(expiresAt: Date) {
  return {
    ok: true as const,
    request: {
      id: REQUEST_ID,
      studentName: "Ada",
      studentAvatarUrl: null,
      subjectName: "Mathematics",
      message: "Stuck on integration by parts",
      durationMinutes: 30,
      priceCredits: 250,
      expiresAt: expiresAt.toISOString(),
      status: "pending",
    },
  };
}

/**
 * The handler the hook registered for `event`, once the channel exists.
 *
 * The hook attaches the session JWT before it builds and subscribes the channel
 * (DECISIONS, "Instant-request fault: the JWT joined after the channel"), so a
 * handler is only bound after those awaits flush. Flushing first, and throwing
 * rather than optional-chaining past a missing handler, keeps a delivery from
 * silently doing nothing — which is exactly how a test would pass while
 * asserting nothing.
 */
async function handlerFor(event: string) {
  await act(async () => {});
  const handler = bound.get(event);
  if (!handler) throw new Error(`no ${event} handler bound — channel not subscribed`);
  return handler;
}

/** Deliver an INSERT the way Realtime would, and let the read-back settle. */
async function deliverInsert() {
  const onInsert = await handlerFor("INSERT");
  await act(async () => {
    onInsert({
      new: { id: REQUEST_ID, status: "pending", tutor_id: TUTOR_ID },
    });
  });
}

/** Let React flush again — one more effect pass, no clock movement. */
async function settle() {
  await act(async () => {});
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  bound.clear();
  getIncomingRequest.mockReset();
  listPendingIncomingRequests.mockReset();
  // Nothing already waiting, unless a test says otherwise: this file is about
  // what an INSERT does.
  listPendingIncomingRequests.mockResolvedValue({ ok: true, requests: [] });
  push.mockReset();
});

afterEach(() => {
  // Unmount BEFORE restoring the real clock. Unmounting runs the countdown's
  // effect cleanup, which calls `clearInterval` on an id the FAKE timers
  // issued; doing that after `useRealTimers()` hands a fake id to the real
  // implementation. `cleanup()` is idempotent, so the setup file's own call is
  // then a no-op — which makes this correct whichever order Vitest runs the
  // two `afterEach` hooks in, rather than relying on knowing that order.
  cleanup();
  vi.useRealTimers();
});

describe("IncomingRequests as a call", () => {
  beforeEach(() => {
    toast.mockReset();
    window.localStorage.clear();
    getIncomingRequest.mockResolvedValue(
      pendingRequest(new Date(NOW.getTime() + TTL_SECONDS * 1000)),
    );
  });

  it("opens with Accept focused, and Accept is the green action", async () => {
    render(<IncomingRequests tutorId={TUTOR_ID} ttlSeconds={TTL_SECONDS} />);
    await deliverInsert();
    await settle();
    const accept = screen.getByRole("button", { name: /^accept and start$/i });
    expect(document.activeElement).toBe(accept);
    expect(accept.className).toContain("bg-live");
  });

  it("announces the request once, and the words don't change as the ring drains", async () => {
    render(<IncomingRequests tutorId={TUTOR_ID} ttlSeconds={TTL_SECONDS} />);
    await deliverInsert();
    const region = () => document.querySelectorAll("[data-call-announcement]");
    expect(region()).toHaveLength(1);
    const first = region()[0].textContent;
    expect(first).toBe("Instant session request from Ada: 30 minutes, Mathematics.");
    await advance(10_000);
    expect(region()).toHaveLength(1);
    expect(region()[0].textContent).toBe(first);
  });

  it("leaves a notice that stays when the ring runs out", async () => {
    render(<IncomingRequests tutorId={TUTOR_ID} ttlSeconds={TTL_SECONDS} />);
    await deliverInsert();
    await advance((TTL_SECONDS + 1) * 1000);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(toast).toHaveBeenCalledTimes(1);
    const [title, opts] = toast.mock.calls[0] as [string, { duration: number }];
    expect(title).toBe("Missed request from Ada");
    expect(opts.duration).toBe(Infinity);
  });

  it("leaves no missed notice when the request is settled elsewhere", async () => {
    render(<IncomingRequests tutorId={TUTOR_ID} ttlSeconds={TTL_SECONDS} />);
    await deliverInsert();
    const onUpdate = await handlerFor("UPDATE");
    await act(async () => {
      onUpdate({ new: { id: REQUEST_ID, status: "cancelled", tutor_id: TUTOR_ID } });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(toast).not.toHaveBeenCalled();
  });

  it("remembers turning the request sound off", async () => {
    render(<IncomingRequests tutorId={TUTOR_ID} ttlSeconds={TTL_SECONDS} />);
    await deliverInsert();
    const sound = screen.getByRole("button", { name: "Request sound" });
    expect(sound.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(sound);
    expect(sound.getAttribute("aria-pressed")).toBe("false");
    expect(window.localStorage.getItem("nowtutors:request-chime-muted")).toBe("1");
  });
});
