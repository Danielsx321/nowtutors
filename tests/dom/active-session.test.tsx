import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * The call survives navigation (instant-session mini-player, 2026-09-29).
 *
 * Faked: the SDK wrapper (leave calls are counted), the token route (fetch),
 * the server action, token renewal, sonner, and `usePathname`, which the test
 * changes to play a navigation. Asserted: moving to another page does not
 * hang up; reaching a sign-in page does, once; the deadline is acted on by one
 * timeout, once; a second booking can't start while one is held; the
 * mini-player shows off the room only, and Enlarge, mic, End and the corner
 * keys work.
 */

const leaves = { count: 0 };
const toggles = { mic: 0 };

vi.mock("@/lib/agora/client", () => ({
  SessionClient: class {
    disposed = false;
    async join() {}
    async leave() {
      if (!this.disposed) leaves.count += 1;
      this.disposed = true;
    }
    async renewToken() {}
    async toggleMic() {
      toggles.mic += 1;
      return false;
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
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const nav = { pathname: "/session/b1" };
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

import { SessionRoom } from "@/components/features/session/session-room";
import {
  ActiveSessionProvider,
  leavesSession,
  useActiveSession,
  type SessionMeta,
} from "@/components/features/session/active-session";
import { MiniPlayer } from "@/components/features/session/mini-player";
import { CORNER_KEY, moveCorner, nearestCorner } from "@/hooks/use-snap-drag";

const meta = (bookingId: string, other = "Elizabeth"): SessionMeta => ({
  bookingId,
  title: "Tutoring session",
  viewerIsTutor: false,
  viewerName: "Dada Daniel",
  otherPartyName: other,
  initialDeadline: null,
  durationMinutes: 60,
});

/** A page: the room on its own path, some other content elsewhere. */
function Page({ bookingId }: { bookingId: string }) {
  return nav.pathname === `/session/${bookingId}` ? <SessionRoom {...meta(bookingId)} /> : <p>Dashboard</p>;
}

let exposed: ReturnType<typeof useActiveSession> | null = null;
function Expose() {
  exposed = useActiveSession();
  return null;
}

function App({ bookingId = "b1" }: { bookingId?: string }) {
  return (
    <ActiveSessionProvider>
      <Page bookingId={bookingId} />
      <MiniPlayer />
      <Expose />
    </ActiveSessionProvider>
  );
}

async function settle() {
  await act(async () => {});
  await act(async () => {});
}

async function joinB1() {
  nav.pathname = "/session/b1";
  const view = render(<App />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Join session" }));
  });
  await settle();
  return view;
}

async function navigate(view: ReturnType<typeof render>, pathname: string) {
  nav.pathname = pathname;
  view.rerender(<App />);
  await settle();
}

beforeEach(() => {
  leaves.count = 0;
  toggles.mic = 0;
  exposed = null;
  getSessionState.mockReset();
  getSessionState.mockResolvedValue({ state: { deadline: null, finished: false } });
  try {
    window.localStorage.removeItem(CORNER_KEY);
  } catch {
    // no storage in this environment
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ token: "t", expiresAt: new Date(Date.now() + 3_600_000).toISOString() }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ActiveSessionProvider", () => {
  it("keeps the call when the person goes to another page", async () => {
    const view = await joinB1();
    expect(exposed?.phase).toBe("live");

    await navigate(view, "/dashboard");
    expect(leaves.count).toBe(0);
    expect(exposed?.phase).toBe("live");
  });

  it("hangs up once on a sign-in page", async () => {
    const view = await joinB1();
    await navigate(view, "/login");
    expect(leaves.count).toBe(1);
    expect(exposed?.meta).toBeNull();
    await navigate(view, "/login");
    expect(leaves.count).toBe(1);
  });

  it("after Log out the room says so instead of reopening the lobby", async () => {
    await joinB1();
    await act(async () => {
      exposed!.leave("sign-out");
    });
    expect(leaves.count).toBe(1);
    expect(screen.getByText("Signing you out…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Join session" })).toBeNull();
  });

  it("knows which pages end a session", () => {
    expect(leavesSession("/login")).toBe(true);
    expect(leavesSession("/auth/callback")).toBe(true);
    expect(leavesSession("/suspended")).toBe(true);
    expect(leavesSession("/dashboard")).toBe(false);
    expect(leavesSession("/tutors")).toBe(false);
    expect(leavesSession("/loginx")).toBe(false);
  });

  it("asks the server once when the deadline passes, not before", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const deadline = new Date(Date.now() + 2000).toISOString();
    getSessionState.mockResolvedValue({ state: { deadline, finished: false } });
    await joinB1();
    const before = getSessionState.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(getSessionState.mock.calls.length).toBe(before);

    getSessionState.mockResolvedValue({ state: { deadline, finished: true } });
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    await settle();
    expect(getSessionState.mock.calls.length).toBe(before + 1);
    expect(exposed?.finished).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(getSessionState.mock.calls.length).toBe(before + 1);
  });

  it("refuses a second booking while one is held", async () => {
    await joinB1();
    let accepted = true;
    act(() => {
      accepted = exposed!.start(meta("b2", "Theo"));
    });
    expect(accepted).toBe(false);
    expect(exposed?.meta?.bookingId).toBe("b1");
  });

  it("the other booking's room says a session is already running", async () => {
    const view = await joinB1();
    nav.pathname = "/session/b2";
    view.rerender(<App bookingId="b2" />);
    await settle();
    expect(screen.getByRole("heading", { name: "You're already in a session" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Back to that session/ }).getAttribute("href")).toBe("/session/b1");
  });
});

describe("MiniPlayer", () => {
  it("is hidden in the room and shown elsewhere while live", async () => {
    const view = await joinB1();
    expect(screen.queryByRole("region", { name: "Current session" })).toBeNull();

    await navigate(view, "/dashboard");
    expect(screen.getByRole("region", { name: "Current session" })).toBeTruthy();
    expect(screen.getByText("Dashboard")).toBeTruthy();
  });

  it("tells the toaster where it is, and nothing while in the room", async () => {
    const view = await joinB1();
    expect(exposed?.playerCorner).toBeNull();
    await navigate(view, "/dashboard");
    expect(exposed?.playerCorner).toBe("br");
  });

  it("is not there before anyone joins", () => {
    nav.pathname = "/dashboard";
    render(<App />);
    expect(screen.queryByRole("region", { name: "Current session" })).toBeNull();
  });

  it("Enlarge goes back to the room", async () => {
    const view = await joinB1();
    await navigate(view, "/dashboard");
    expect(screen.getByRole("link", { name: "Enlarge" }).getAttribute("href")).toBe("/session/b1");
  });

  it("toggles the mic through the call", async () => {
    const view = await joinB1();
    await navigate(view, "/dashboard/messages");
    const mic = screen.getByRole("button", { name: "Microphone" });
    await act(async () => {
      fireEvent.click(mic);
    });
    expect(toggles.mic).toBe(1);
    expect(screen.getByRole("button", { name: "Microphone" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("End opens the same confirm as the room", async () => {
    const view = await joinB1();
    await navigate(view, "/dashboard");
    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    expect(await screen.findByRole("heading", { name: "End this session?" })).toBeTruthy();
  });

  it("arrow keys move it to another corner and remember it", async () => {
    // This test lane has no Web Storage; the hook guards for that, the test fakes it.
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    const view = await joinB1();
    await navigate(view, "/dashboard");
    const handle = screen.getByRole("button", { name: /Move the session player/ });
    const panel = screen.getByRole("region", { name: "Current session" });
    expect(panel.className).toContain("right-3");

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(screen.getByRole("region", { name: "Current session" }).className).toContain("left-3");
    expect(store.get(CORNER_KEY)).toBe("bl");
  });

  it("says the session ended, then goes away", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const view = await joinB1();
    await navigate(view, "/dashboard");
    await act(async () => {
      exposed!.finish();
    });
    expect(screen.getByText("Session ended")).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(8100);
    });
    expect(screen.queryByRole("region", { name: "Current session" })).toBeNull();
    expect(exposed?.meta).toBeNull();
  });
});

describe("corner maths", () => {
  it("picks the corner by viewport half", () => {
    expect(nearestCorner(10, 10, 1000, 800)).toBe("tl");
    expect(nearestCorner(900, 700, 1000, 800)).toBe("br");
    expect(nearestCorner(900, 10, 1000, 800)).toBe("tr");
  });

  it("moves along an edge and stops at it", () => {
    expect(moveCorner("br", "ArrowLeft")).toBe("bl");
    expect(moveCorner("bl", "ArrowLeft")).toBe("bl");
    expect(moveCorner("bl", "ArrowUp")).toBe("tl");
  });
});
