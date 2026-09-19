import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * When the other person leaves, the room asks the server what is true
 * (found on production 2026-09-19: the tutor ended the session and the
 * student's room stayed open with the clock running).
 *
 * Faked: the SDK wrapper (its handlers are captured so the test can play the
 * "other person left" event), the lobby (it asks for devices), the token
 * route (fetch), the server action, and token renewal. Asserted: a departure
 * calls `getSessionState`; when the server says the session is finished the
 * room shows "Session ended"; when it isn't (a dropped connection), the room
 * stays up and waits.
 */

type Handlers = { onRemotePresence?: (present: boolean) => void };
const captured: { handlers: Handlers | null } = { handlers: null };

vi.mock("@/lib/agora/client", () => ({
  SessionClient: class {
    disposed = false;
    constructor(handlers: Handlers) {
      captured.handlers = handlers;
    }
    async join() {}
    async leave() {
      this.disposed = true;
    }
    async renewToken() {}
    async toggleMic() {
      return true;
    }
    async toggleCamera() {
      return null;
    }
  },
}));

vi.mock("@/components/features/session/lobby", () => ({
  Lobby: ({ onJoin }: { onJoin: () => void }) => (
    <button type="button" onClick={onJoin}>
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

import { SessionRoom } from "@/components/features/session/session-room";

const notFinished = { state: { deadline: null, finished: false } };

async function joinRoom() {
  render(
    <SessionRoom
      bookingId="00000000-0000-4000-8000-000000000001"
      title="Tutoring session"
      viewerIsTutor={false}
      viewerName="Dada Daniel"
      otherPartyName="Elizabeth"
      initialDeadline={null}
      durationMinutes={60}
    />,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Join session" }));
  });
  await act(async () => {});
}

beforeEach(() => {
  captured.handlers = null;
  getSessionState.mockReset();
  getSessionState.mockResolvedValue(notFinished);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ token: "t", expiresAt: new Date(Date.now() + 3_600_000).toISOString() }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SessionRoom, the other person leaves", () => {
  it("closes the room when the server says the session is over", async () => {
    await joinRoom();
    const callsBefore = getSessionState.mock.calls.length;

    getSessionState.mockResolvedValue({ state: { deadline: null, finished: true } });
    await act(async () => {
      captured.handlers?.onRemotePresence?.(false);
    });

    expect(getSessionState.mock.calls.length).toBe(callsBefore + 1);
    expect(screen.getByRole("heading", { name: "Session ended" })).toBeTruthy();
  });

  it("stays open when the other person only dropped", async () => {
    await joinRoom();
    await act(async () => {
      captured.handlers?.onRemotePresence?.(false);
    });

    expect(screen.queryByRole("heading", { name: "Session ended" })).toBeNull();
    expect(screen.getByRole("toolbar", { name: "Session controls" })).toBeTruthy();
  });
});
