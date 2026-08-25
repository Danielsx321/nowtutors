import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

/**
 * The tutor's incoming-request modal, rendered (SPEC §7.4, §8).
 *
 * **This is the test that was missing.** The suite had 333 passing unit tests
 * and not one of them could have caught the defect this file exists for: an
 * INSERT arrived, the queue took the request, and the modal was torn down in
 * the same flush that seeded its countdown — so the tutor was never shown
 * anything at all. Nothing about that is visible in a pure function's return
 * value. It is a property of a render happening before an effect, and asserting
 * it needs a renderer and a DOM.
 *
 * **What is faked is only what leaves the browser**, so the failure has
 * somewhere to live:
 *  - `@/lib/supabase/client` — the socket. The REAL `useIncomingSessionRequests`
 *    runs on top of it, so the channel wiring, the `status === "pending"`
 *    filter and the payload-is-a-notification handling are all under test.
 *  - `@/actions/session-requests` — the Server Actions, which cannot execute in
 *    jsdom. They are the network edge, not the logic being asserted.
 *  - `next/navigation` — `useRouter` has no App Router to come from here.
 *
 * `useCountdown` and `IncomingRequests` itself are the real modules.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
}));

const getIncomingRequest = vi.fn();
const acceptSessionRequest = vi.fn();
const declineSessionRequest = vi.fn();
vi.mock("@/actions/session-requests", () => ({
  getIncomingRequest: (id: string) => getIncomingRequest(id),
  acceptSessionRequest: (id: string) => acceptSessionRequest(id),
  declineSessionRequest: (id: string) => declineSessionRequest(id),
}));

/** The `postgres_changes` callbacks the hook registers, keyed by event. */
type Payload = { new: Record<string, unknown> };
const bound = new Map<string, (payload: Payload) => void>();
const removeChannel = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
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
        subscribe() {
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

/** Deliver an INSERT the way Realtime would, and let the read-back settle. */
async function deliverInsert() {
  await act(async () => {
    bound.get("INSERT")?.({
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

describe("IncomingRequests", () => {
  it("shows nothing until a request arrives", () => {
    render(<IncomingRequests tutorId={TUTOR_ID} ttlSeconds={TTL_SECONDS} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(bound.has("INSERT")).toBe(true);
  });

  it("paints the modal on an INSERT and keeps it painted on the next flush", async () => {
    getIncomingRequest.mockResolvedValue(
      pendingRequest(new Date(NOW.getTime() + TTL_SECONDS * 1000)),
    );
    render(<IncomingRequests tutorId={TUTOR_ID} ttlSeconds={TTL_SECONDS} />);

    await deliverInsert();

    // Visible at all — this is the assertion the whole file exists for. Before
    // the `useCountdown` fix, `elapsed` was true on the render that first had a
    // deadline, and the effect at incoming-requests.tsx:86 dropped the request
    // in the same flush; the dialog never reached the document.
    const dialog = screen.getByRole("dialog");
    expect(dialog).not.toBeNull();
    expect(screen.getByText("Instant session request")).not.toBeNull();
    expect(screen.getByText(/Ada wants to start now/)).not.toBeNull();

    // Seeded with the full window rather than the stale 0 it used to show.
    expect(screen.getByRole("timer").textContent).toContain("60");

    // And it STAYS. A single visible render would have been just as broken —
    // the fault dropped the row one flush later, not immediately.
    await settle();
    expect(screen.queryByRole("dialog")).not.toBeNull();

    await advance(1_000);
    expect(screen.queryByRole("dialog")).not.toBeNull();
    expect(screen.getByRole("timer").textContent).toContain("59");

    await advance(5_000);
    expect(screen.queryByRole("dialog")).not.toBeNull();
    expect(screen.getByRole("timer").textContent).toContain("54");
  });

  it("still closes the modal once the deadline genuinely passes", async () => {
    getIncomingRequest.mockResolvedValue(
      pendingRequest(new Date(NOW.getTime() + TTL_SECONDS * 1000)),
    );
    render(<IncomingRequests tutorId={TUTOR_ID} ttlSeconds={TTL_SECONDS} />);
    await deliverInsert();
    expect(screen.queryByRole("dialog")).not.toBeNull();

    // One second short of the window: a decision the tutor can still make.
    await advance((TTL_SECONDS - 1) * 1000);
    expect(screen.queryByRole("dialog")).not.toBeNull();

    // Past it. Expiry is the server's — this is the local consequence, and the
    // fix must not have bought the modal's life by disabling it.
    await advance(2_000);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the modal when the row leaves `pending` (UPDATE)", async () => {
    getIncomingRequest.mockResolvedValue(
      pendingRequest(new Date(NOW.getTime() + TTL_SECONDS * 1000)),
    );
    render(<IncomingRequests tutorId={TUTOR_ID} ttlSeconds={TTL_SECONDS} />);
    await deliverInsert();
    expect(screen.queryByRole("dialog")).not.toBeNull();

    await act(async () => {
      bound.get("UPDATE")?.({
        new: { id: REQUEST_ID, status: "cancelled", tutor_id: TUTOR_ID },
      });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows nothing for a request that is no longer pending by the read-back", async () => {
    const stale = pendingRequest(new Date(NOW.getTime() + TTL_SECONDS * 1000));
    getIncomingRequest.mockResolvedValue({
      ok: true as const,
      request: { ...stale.request, status: "expired" },
    });
    render(<IncomingRequests tutorId={TUTOR_ID} ttlSeconds={TTL_SECONDS} />);
    await deliverInsert();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not read back an INSERT that is not pending", async () => {
    render(<IncomingRequests tutorId={TUTOR_ID} ttlSeconds={TTL_SECONDS} />);
    await act(async () => {
      bound.get("INSERT")?.({
        new: { id: REQUEST_ID, status: "expired", tutor_id: TUTOR_ID },
      });
    });
    expect(getIncomingRequest).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
