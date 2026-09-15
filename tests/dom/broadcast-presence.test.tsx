import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

/**
 * The host's viewer count (SPEC §7.8, §8; Phase 9 Part 3). The real
 * `useBroadcastPresence` and retrying channel run on a faked Presence socket.
 *
 * Asserted: the count follows each `sync`, the host reports only a new high
 * (never a drop, never the same number twice), and the host tracks nothing, so
 * they aren't counted as a viewer.
 */

let presenceState: Record<string, { role?: string }[]> = {};
let sync: (() => void) | null = null;
const track = vi.fn(async () => "ok");

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } }, error: null }),
    },
    realtime: { setAuth: async () => {} },
    channel: () => {
      const channel = {
        on(type: string, filter: { event: string }, cb: () => void) {
          if (type === "presence" && filter.event === "sync") sync = cb;
          return channel;
        },
        subscribe(cb: (status: string) => void) {
          cb("SUBSCRIBED");
          return channel;
        },
        presenceState: () => presenceState,
        track,
      };
      return channel;
    },
    removeChannel: vi.fn(),
  }),
}));

import { useBroadcastPresence } from "@/hooks/use-broadcast-presence";

function Host({ onNewPeak }: { onNewPeak: (n: number) => void }) {
  const { count } = useBroadcastPresence("b1", { onNewPeak });
  return <p>{count} watching</p>;
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function syncWith(state: Record<string, { role?: string }[]>) {
  presenceState = state;
  await act(async () => sync?.());
}

beforeEach(() => {
  presenceState = {};
  sync = null;
  track.mockClear();
});

describe("host viewer count", () => {
  it("follows sync and reports only new highs", async () => {
    const onNewPeak = vi.fn();
    render(<Host onNewPeak={onNewPeak} />);
    await flush();
    expect(sync).not.toBeNull();

    await syncWith({ a: [{ role: "viewer" }], b: [{ role: "viewer" }] });
    expect(screen.getByText("2 watching")).toBeTruthy();
    expect(onNewPeak).toHaveBeenLastCalledWith(2);

    await syncWith({ a: [{ role: "viewer" }] });
    expect(screen.getByText("1 watching")).toBeTruthy();

    await syncWith({ a: [{ role: "viewer" }], b: [{ role: "viewer" }] });
    expect(screen.getByText("2 watching")).toBeTruthy();

    await syncWith({ a: [{ role: "viewer" }], b: [{ role: "viewer" }], c: [{ role: "viewer" }] });
    expect(screen.getByText("3 watching")).toBeTruthy();

    expect(onNewPeak.mock.calls).toEqual([[2], [3]]);
  });

  it("doesn't track the host", async () => {
    render(<Host onNewPeak={vi.fn()} />);
    await flush();
    expect(track).not.toHaveBeenCalled();
  });
});
