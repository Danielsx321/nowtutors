import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

/**
 * The viewer's broadcast stage, rendered (SPEC §7.8; Phase 9 Part 3).
 *
 * Faked: the Agora wrapper (a class that records its handlers), the token
 * fetch, the watchable re-read action and the Supabase socket. The real
 * `ViewerStage`, `useBroadcastPresence`, retrying channel and token-renewal
 * hook run.
 *
 * Asserted: when Agora says the host left and the server agrees the broadcast
 * is over, the stage shows "ended" and leaves the channel; when the server says
 * it's still live (a host reconnecting), it keeps waiting; a token refused with
 * 404 at join is "ended" too; and the viewer tracks itself in Presence.
 */

type Handlers = {
  onHostVideo?: (t: unknown) => void;
  onHostPresence?: (present: boolean) => void;
};
const clients: { handlers: Handlers; join: ReturnType<typeof vi.fn>; leave: ReturnType<typeof vi.fn> }[] = [];

vi.mock("@/lib/agora/live-client", () => ({
  LiveClient: class {
    handlers: Handlers;
    join = vi.fn(async () => {});
    leave = vi.fn(async () => {});
    renewToken = vi.fn(async () => {});
    disposed = false;
    constructor(handlers: Handlers) {
      this.handlers = handlers;
      clients.push(this);
    }
  },
}));

const getBroadcastWatchable = vi.fn();
vi.mock("@/actions/broadcasts", () => ({
  getBroadcastWatchable: (input: unknown) => getBroadcastWatchable(input),
}));

const track = vi.fn(async () => "ok");
let presenceState: Record<string, { role?: string }[]> = {};
const channelOpts: unknown[] = [];
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } }, error: null }),
    },
    realtime: { setAuth: async () => {} },
    channel: (_topic: string, opts: unknown) => {
      channelOpts.push(opts);
      const channel = {
        on() {
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

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ name }: { name: string }) => <span>{name}</span>,
}));

import { ViewerStage } from "@/components/features/broadcasts/viewer-stage";

const BROADCAST = "33333333-3333-4333-8333-333333333333";
const GRANT = {
  token: "tok",
  uid: 7,
  appId: "app",
  channel: `broadcast_${BROADCAST}`,
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  isHost: false,
};

function mockToken(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })),
  );
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  clients.length = 0;
  channelOpts.length = 0;
  presenceState = {};
  track.mockClear();
  getBroadcastWatchable.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ViewerStage", () => {
  it("shows the broadcast has ended when the host leaves and the server agrees", async () => {
    mockToken(200, GRANT);
    getBroadcastWatchable.mockResolvedValue({ watchable: false });
    render(<ViewerStage broadcastId={BROADCAST} tutorName="Theo" viewerKey="7" />);
    await flush();
    expect(clients[0].join).toHaveBeenCalledWith(GRANT);

    await act(async () => clients[0].handlers.onHostPresence?.(false));
    await flush();

    expect(getBroadcastWatchable).toHaveBeenCalledWith({ broadcastId: BROADCAST });
    expect(screen.getByText("This broadcast has ended")).toBeTruthy();
    expect(clients[0].leave).toHaveBeenCalled();
  });

  it("keeps waiting when the host drops but the broadcast is still live", async () => {
    mockToken(200, GRANT);
    getBroadcastWatchable.mockResolvedValue({ watchable: true });
    render(<ViewerStage broadcastId={BROADCAST} tutorName="Theo" viewerKey="7" />);
    await flush();

    await act(async () => clients[0].handlers.onHostPresence?.(false));
    await flush();

    expect(screen.queryByText("This broadcast has ended")).toBeNull();
    expect(screen.getByText("Waiting to join…")).toBeTruthy();
  });

  it("treats a token refused with 404 as ended, without asking again", async () => {
    mockToken(404, { error: "This broadcast isn't live." });
    render(<ViewerStage broadcastId={BROADCAST} tutorName="Theo" viewerKey="7" />);
    await flush();

    expect(screen.getByText("This broadcast has ended")).toBeTruthy();
    expect(clients[0].join).not.toHaveBeenCalled();
  });

  it("tracks the viewer in Presence under their key", async () => {
    mockToken(200, GRANT);
    render(<ViewerStage broadcastId={BROADCAST} tutorName="Theo" viewerKey="7" />);
    await flush();

    expect(channelOpts).toContainEqual({ config: { presence: { key: "7" } } });
    expect(track).toHaveBeenCalledWith({ role: "viewer" });
  });
});
