import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

/**
 * The step before the room (design overhaul Part 4).
 *
 * `navigator.mediaDevices.getUserMedia` is the only fake: it is the browser's
 * permission prompt. Asserted: Join stays disabled while checking and when the
 * check fails; a blocked device shows the fix in words; Try again re-runs the
 * check; a passed check enables Join; Join stops the preview tracks before
 * handing over, so the SDK takes the devices over cleanly; a student is only
 * asked for a microphone.
 */

import { Lobby } from "@/components/features/session/lobby";

const getUserMedia = vi.fn();

function fakeStream() {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  return { stream: { getTracks: () => tracks } as unknown as MediaStream, tracks };
}

function domError(name: string) {
  const e = new Error(name);
  e.name = name;
  return e;
}

beforeEach(() => {
  getUserMedia.mockReset();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: () => Promise.resolve(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function renderLobby(props: Partial<React.ComponentProps<typeof Lobby>> = {}) {
  const onJoin = vi.fn();
  await act(async () => {
    render(<Lobby needsCamera={false} otherPartyName="Amina" onJoin={onJoin} {...props} />);
  });
  return { onJoin, join: () => screen.getByRole("button", { name: "Join session" }) };
}

describe("Lobby", () => {
  it("a blocked microphone explains the fix and keeps Join disabled", async () => {
    getUserMedia.mockRejectedValue(domError("NotAllowedError"));
    const { join } = await renderLobby();
    expect(screen.getByText("Microphone blocked. Allow it in your browser's address bar, then try again.")).toBeTruthy();
    expect((join() as HTMLButtonElement).disabled).toBe(true);
  });

  it("a blocked camera says camera for a tutor", async () => {
    getUserMedia.mockRejectedValue(domError("NotAllowedError"));
    await renderLobby({ needsCamera: true });
    expect(screen.getByText(/Camera or microphone blocked\. Allow it in your browser's address bar/)).toBeTruthy();
  });

  it("Try again re-runs the check, and a passed check enables Join", async () => {
    getUserMedia.mockRejectedValueOnce(domError("NotReadableError"));
    const { join } = await renderLobby();
    expect(screen.getByText(/Another app is using your microphone or camera/)).toBeTruthy();
    getUserMedia.mockResolvedValueOnce(fakeStream().stream);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(screen.getByText("Microphone ready")).toBeTruthy();
    expect((join() as HTMLButtonElement).disabled).toBe(false);
  });

  it("Join releases the preview devices before handing over", async () => {
    const { stream, tracks } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    const { join, onJoin } = await renderLobby();
    fireEvent.click(join());
    expect(tracks.every((t) => t.stop.mock.calls.length > 0)).toBe(true);
    expect(onJoin).toHaveBeenCalledTimes(1);
  });

  it("asks a student for a microphone only, and a tutor for both", async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream);
    await renderLobby();
    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: true, video: false });
    getUserMedia.mockClear();
    await act(async () => {
      render(<Lobby needsCamera otherPartyName="Sam" onJoin={() => {}} />);
    });
    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: true, video: true });
  });

  it("Join is disabled while the check is still running", async () => {
    getUserMedia.mockReturnValue(new Promise(() => {}));
    const { join } = await renderLobby();
    expect((join() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Checking your microphone/)).toBeTruthy();
  });
});
