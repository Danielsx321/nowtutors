import * as React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The student's waiting modal learns of an accept through a Realtime UPDATE and,
 * since 2026-09-30, through `getOutgoingRequest` as well: read after every
 * (re)subscribe and once when the ring runs out. These tests pin the second leg.
 * The fault it closes was seen live: the socket was still reconnecting after
 * the first session, the UPDATE never arrived, the ring ran out and the student
 * was told "No answer" for a session the tutor was already sitting in.
 */

const getOutgoingRequest = vi.fn();
vi.mock("@/actions/session-requests", () => ({
  getOutgoingRequest: (id: string) => getOutgoingRequest(id),
}));

type Payload = { new: Record<string, unknown> };
type StatusCallback = (status: string, err?: Error) => void;
interface FakeChannel {
  handlers: Map<string, (payload: Payload) => void>;
  status: StatusCallback | null;
  on(type: string, opts: { event: string }, cb: (payload: Payload) => void): FakeChannel;
  subscribe(cb: StatusCallback): FakeChannel;
}
const channels: FakeChannel[] = [];
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: "jwt" } }, error: null }) },
    realtime: { setAuth: async () => {} },
    channel: () => {
      const channel: FakeChannel = {
        handlers: new Map(),
        status: null,
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
    removeChannel: vi.fn(),
  }),
}));

import {
  useOutgoingSessionRequest,
  type OutgoingRequestState,
} from "@/hooks/use-session-requests";

const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const BOOKING_ID = "44444444-4444-4444-8444-444444444444";

let exposed: OutgoingRequestState | null = null;
function Probe({ elapsed }: { elapsed: boolean }) {
  exposed = useOutgoingSessionRequest(REQUEST_ID, elapsed);
  return null;
}

const latest = () => channels[channels.length - 1];
async function settle() {
  await act(async () => {});
  await act(async () => {});
}
async function reportStatus(status: string) {
  await act(async () => {
    latest().status?.(status);
  });
  await settle();
}

beforeEach(() => {
  channels.length = 0;
  exposed = null;
  getOutgoingRequest.mockReset();
  getOutgoingRequest.mockResolvedValue({ ok: true, status: "pending", bookingId: null });
});

afterEach(() => {
  cleanup();
});

describe("useOutgoingSessionRequest fallback read", () => {
  it("reads the row back once the channel subscribes, and surfaces an accept the event never delivered", async () => {
    getOutgoingRequest.mockResolvedValue({ ok: true, status: "accepted", bookingId: BOOKING_ID });
    render(<Probe elapsed={false} />);
    await settle();
    expect(getOutgoingRequest).not.toHaveBeenCalled();

    await reportStatus("SUBSCRIBED");
    expect(getOutgoingRequest).toHaveBeenCalledWith(REQUEST_ID);
    expect(exposed).toEqual({ status: "accepted", bookingId: BOOKING_ID });
  });

  it("reads the row back when the ring runs out, so 'No answer' is never said over an accept", async () => {
    const view = render(<Probe elapsed={false} />);
    await settle();
    await reportStatus("SUBSCRIBED");
    expect(getOutgoingRequest).toHaveBeenCalledTimes(1);
    expect(exposed).toBeNull();

    getOutgoingRequest.mockResolvedValue({ ok: true, status: "accepted", bookingId: BOOKING_ID });
    view.rerender(<Probe elapsed />);
    await settle();
    expect(getOutgoingRequest).toHaveBeenCalledTimes(2);
    expect(exposed).toEqual({ status: "accepted", bookingId: BOOKING_ID });
  });

  it("a pending read-back changes nothing, and never overwrites a terminal status the event delivered", async () => {
    render(<Probe elapsed={false} />);
    await settle();
    await reportStatus("SUBSCRIBED");
    expect(exposed).toBeNull();

    await act(async () => {
      latest().handlers.get("UPDATE")?.({ new: { id: REQUEST_ID, status: "declined", booking_id: null } });
    });
    expect(exposed).toEqual({ status: "declined", bookingId: null });

    // A later read (a resubscribe) that somehow says `expired` does not replace it.
    getOutgoingRequest.mockResolvedValue({ ok: true, status: "expired", bookingId: null });
    await reportStatus("SUBSCRIBED");
    expect(exposed).toEqual({ status: "declined", bookingId: null });
  });

  it("an error from the read is swallowed; the channel and the ring still stand", async () => {
    getOutgoingRequest.mockResolvedValue({ error: "That request no longer exists." });
    render(<Probe elapsed />);
    await settle();
    await reportStatus("SUBSCRIBED");
    expect(exposed).toBeNull();
  });
});
