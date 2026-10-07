import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * Room features of 2026-09-30: both cameras, screen share and the chat panel.
 * The SDK is faked at the `SessionClient` boundary, as the other room tests do.
 */

type Handlers = {
  onLocalVideo?: (t: unknown) => void;
  onLocalScreen?: (t: unknown) => void;
  onRemoteVideo?: (t: unknown) => void;
  onRemotePresence?: (present: boolean) => void;
};
const captured: { handlers: Handlers | null; sharing: boolean } = { handlers: null, sharing: false };
const fakeTrack = () => ({ play: vi.fn(), stop: vi.fn() });

vi.mock("@/lib/agora/client", () => ({
  SessionClient: class {
    disposed = false;
    hasCamera = true;
    constructor(handlers: Handlers) {
      captured.handlers = handlers;
    }
    get sharingScreen() {
      return captured.sharing;
    }
    async join() {
      captured.handlers?.onLocalVideo?.(fakeTrack());
    }
    async leave() {
      this.disposed = true;
    }
    async renewToken() {}
    async toggleMic() {
      return true;
    }
    async toggleCamera() {
      return false;
    }
    async startScreenShare() {
      captured.sharing = true;
      captured.handlers?.onLocalScreen?.(fakeTrack());
      return true;
    }
    async stopScreenShare() {
      captured.sharing = false;
      captured.handlers?.onLocalScreen?.(null);
    }
  },
}));

vi.mock("@/components/features/session/lobby", () => ({
  Lobby: ({ onJoin, needsCamera, cameraOptional }: { onJoin: () => void; needsCamera: boolean; cameraOptional?: boolean }) => (
    <button type="button" onClick={onJoin} data-camera={String(needsCamera)} data-optional={String(cameraOptional ?? false)}>
      Join session
    </button>
  ),
}));

const getSessionState = vi.fn();
vi.mock("@/actions/sessions", () => ({
  getSessionState: (id: string) => getSessionState(id),
  endSession: vi.fn(),
}));
vi.mock("@/hooks/use-token-renewal", () => ({ useTokenRenewal: () => {} }));
vi.mock("sonner", () => ({ toast: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/session/00000000-0000-4000-8000-000000000001" }));

const signal = { remoteSharing: false };
vi.mock("@/hooks/use-session-share-signal", () => ({
  useSessionShareSignal: () => ({ remoteSharing: signal.remoteSharing, status: "connecting" }),
}));

const threadProps: { last: Record<string, unknown> | null } = { last: null };
vi.mock("@/components/features/messaging/thread", () => ({
  Thread: (props: Record<string, unknown>) => {
    threadProps.last = props;
    return <div data-testid="thread">thread for {String(props.conversationId)}</div>;
  },
}));

import { SessionRoom } from "@/components/features/session/session-room";
import { ActiveSessionProvider } from "@/components/features/session/active-session";

const BOOKING = "00000000-0000-4000-8000-000000000001";
const chat = {
  conversationId: "c1",
  viewerId: "u1",
  initialMessages: [],
  initialHasOlder: false,
};

async function joinRoom(over: { viewerIsTutor?: boolean; withChat?: boolean } = {}) {
  render(
    <ActiveSessionProvider>
      <SessionRoom
        bookingId={BOOKING}
        title="Tutoring session"
        viewerIsTutor={over.viewerIsTutor ?? false}
        viewerName="Dada Daniel"
        otherPartyName="Elizabeth"
        initialDeadline={null}
        durationMinutes={60}
        chat={over.withChat === false ? null : chat}
      />
    </ActiveSessionProvider>,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Join session" }));
  });
  await act(async () => {});
  await act(async () => {});
}

beforeEach(() => {
  captured.handlers = null;
  captured.sharing = false;
  signal.remoteSharing = false;
  threadProps.last = null;
  getSessionState.mockReset();
  getSessionState.mockResolvedValue({ state: { deadline: null, unmetDeadline: null, finished: false, status: "in_progress" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ token: "t", expiresAt: new Date(Date.now() + 3_600_000).toISOString() }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getDisplayMedia: vi.fn() },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("student camera", () => {
  it("asks the lobby for a camera that is optional for a student, required for a tutor", async () => {
    render(
      <ActiveSessionProvider>
        <SessionRoom bookingId={BOOKING} title="t" viewerIsTutor={false} viewerName="D" otherPartyName="E" initialDeadline={null} durationMinutes={60} />
      </ActiveSessionProvider>,
    );
    const join = screen.getByRole("button", { name: "Join session" });
    expect(join.getAttribute("data-camera")).toBe("true");
    expect(join.getAttribute("data-optional")).toBe("true");
    cleanup();
    render(
      <ActiveSessionProvider>
        <SessionRoom bookingId={BOOKING} title="t" viewerIsTutor={true} viewerName="D" otherPartyName="E" initialDeadline={null} durationMinutes={60} />
      </ActiveSessionProvider>,
    );
    expect(screen.getByRole("button", { name: "Join session" }).getAttribute("data-optional")).toBe("false");
  });

  it("gives a student the Camera button once joined", async () => {
    await joinRoom({ viewerIsTutor: false });
    expect(screen.getByRole("button", { name: "Camera" })).not.toBeNull();
  });
});

describe("screen share", () => {
  it("offers Share when the browser can capture a screen, and sharing takes the spotlight", async () => {
    await joinRoom({ viewerIsTutor: false });
    const share = screen.getByRole("button", { name: "Share screen" });
    expect(share.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      fireEvent.click(share);
    });
    await act(async () => {});

    expect(screen.getByRole("button", { name: "Share screen" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Sharing your screen")).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share screen" }));
    });
    await act(async () => {});
    expect(screen.queryByText("Sharing your screen")).toBeNull();
  });

  it("hides Share when the browser has no screen capture", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {} });
    await joinRoom();
    expect(screen.queryByRole("button", { name: "Share screen" })).toBeNull();
  });

  it("tags the other person's picture when the room signal says they are sharing", async () => {
    signal.remoteSharing = true;
    await joinRoom({ viewerIsTutor: true });
    await act(async () => {
      captured.handlers?.onRemotePresence?.(true);
      captured.handlers?.onRemoteVideo?.(fakeTrack());
    });
    expect(screen.getByText("Sharing screen")).not.toBeNull();
  });
});

describe("chat panel", () => {
  it("is closed until Chat is pressed, then shows the pair's thread", async () => {
    await joinRoom();
    expect(screen.getByRole("complementary", { name: "Session chat", hidden: true }).className).toContain("hidden");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    });
    expect(screen.getByRole("complementary", { name: "Session chat" }).className).not.toContain("hidden");
    expect(screen.getByTestId("thread").textContent).toContain("c1");
    expect(threadProps.last?.viewerId).toBe("u1");
  });

  it("counts messages that arrive while the panel is closed, and clears on open", async () => {
    await joinRoom();
    const onIncoming = threadProps.last?.onIncoming as ((m: unknown) => void) | undefined;
    await act(async () => {
      onIncoming?.({ id: "m1" });
      onIncoming?.({ id: "m2" });
    });
    expect(screen.getByRole("button", { name: "Chat, 2 unread" })).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Chat, 2 unread" }));
    });
    expect(screen.getByRole("button", { name: "Chat" })).not.toBeNull();
  });

  it("has no Chat button when the room has no conversation", async () => {
    await joinRoom({ withChat: false });
    expect(screen.queryByRole("button", { name: /Chat/ })).toBeNull();
  });
});
