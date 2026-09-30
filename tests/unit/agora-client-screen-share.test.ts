import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Screen share in `SessionClient` (SPEC §9, built 2026-09-30). An Agora client
 * publishes one video track at a time, so sharing swaps the camera out and
 * stopping swaps it back; these tests pin that order and the two ways a share
 * ends (the button, and the browser's own Stop sharing bar).
 */

const mic = { setEnabled: vi.fn().mockResolvedValue(undefined), stop: vi.fn(), close: vi.fn() };
const camera = { setEnabled: vi.fn().mockResolvedValue(undefined), stop: vi.fn(), close: vi.fn() };
const screenHandlers = new Map<string, () => void>();
const screen = {
  stop: vi.fn(),
  close: vi.fn(),
  on: vi.fn((event: string, cb: () => void) => {
    screenHandlers.set(event, cb);
  }),
};

const rtcClient = {
  join: vi.fn().mockResolvedValue(undefined),
  publish: vi.fn().mockResolvedValue(undefined),
  unpublish: vi.fn().mockResolvedValue(undefined),
  leave: vi.fn().mockResolvedValue(undefined),
  renewToken: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  removeAllListeners: vi.fn(),
};

const createScreenVideoTrack = vi.fn();
vi.mock("agora-rtc-sdk-ng", () => ({
  default: {
    createClient: vi.fn(() => rtcClient),
    createMicrophoneAndCameraTracks: vi.fn().mockResolvedValue([mic, camera]),
    createMicrophoneAudioTrack: vi.fn().mockResolvedValue(mic),
    createScreenVideoTrack: (...args: unknown[]) => createScreenVideoTrack(...args),
  },
}));

const GRANT = {
  token: "tok",
  uid: 1,
  appId: "app",
  channel: "session_x",
  expiresAt: new Date().toISOString(),
  isTutor: true,
};

async function joined() {
  const { SessionClient } = await import("@/lib/agora/client");
  const onLocalScreen = vi.fn();
  const onError = vi.fn();
  const client = new SessionClient({ onLocalScreen, onError });
  await client.join(GRANT);
  rtcClient.publish.mockClear();
  return { client, onLocalScreen, onError };
}

beforeEach(() => {
  vi.clearAllMocks();
  screenHandlers.clear();
  rtcClient.publish.mockResolvedValue(undefined);
  rtcClient.unpublish.mockResolvedValue(undefined);
  createScreenVideoTrack.mockResolvedValue(screen);
});

describe("startScreenShare", () => {
  it("unpublishes the camera, publishes the screen, and reports the track", async () => {
    const { client, onLocalScreen } = await joined();

    expect(await client.startScreenShare()).toBe(true);

    expect(createScreenVideoTrack).toHaveBeenCalledWith({ encoderConfig: "1080p_1" }, "disable");
    expect(rtcClient.unpublish).toHaveBeenCalledWith(camera);
    expect(rtcClient.publish).toHaveBeenCalledWith(screen);
    // Order: the camera leaves the wire before the screen takes it.
    expect(rtcClient.unpublish.mock.invocationCallOrder[0]).toBeLessThan(
      rtcClient.publish.mock.invocationCallOrder[0],
    );
    expect(onLocalScreen).toHaveBeenLastCalledWith(screen);
    expect(client.sharingScreen).toBe(true);
  });

  it("a dismissed picker is not an error and changes nothing", async () => {
    const { client, onError, onLocalScreen } = await joined();
    createScreenVideoTrack.mockRejectedValueOnce(
      Object.assign(new Error("Permission denied"), { code: "PERMISSION_DENIED" }),
    );

    expect(await client.startScreenShare()).toBe(false);

    expect(rtcClient.unpublish).not.toHaveBeenCalled();
    expect(rtcClient.publish).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onLocalScreen).not.toHaveBeenCalled();
    expect(client.sharingScreen).toBe(false);
  });

  it("puts the camera back if publishing the screen fails, and says so", async () => {
    const { client, onError } = await joined();
    rtcClient.publish.mockRejectedValueOnce(new Error("publish refused"));

    expect(await client.startScreenShare()).toBe(false);

    expect(screen.close).toHaveBeenCalled();
    // The second publish is the camera going back on the wire.
    expect(rtcClient.publish).toHaveBeenLastCalledWith(camera);
    expect(onError).toHaveBeenCalled();
    expect(client.sharingScreen).toBe(false);
  });

  it("a second start while sharing is refused", async () => {
    const { client } = await joined();
    expect(await client.startScreenShare()).toBe(true);
    expect(await client.startScreenShare()).toBe(false);
    expect(createScreenVideoTrack).toHaveBeenCalledTimes(1);
  });
});

describe("stopScreenShare", () => {
  it("closes the screen, unpublishes it, republishes the camera and reports null", async () => {
    const { client, onLocalScreen } = await joined();
    await client.startScreenShare();
    rtcClient.publish.mockClear();
    rtcClient.unpublish.mockClear();

    await client.stopScreenShare();

    expect(screen.stop).toHaveBeenCalled();
    expect(screen.close).toHaveBeenCalled();
    expect(rtcClient.unpublish).toHaveBeenCalledWith(screen);
    expect(rtcClient.publish).toHaveBeenCalledWith(camera);
    expect(onLocalScreen).toHaveBeenLastCalledWith(null);
    expect(client.sharingScreen).toBe(false);
  });

  it("the browser's own Stop sharing ends it the same way", async () => {
    const { client, onLocalScreen } = await joined();
    await client.startScreenShare();
    rtcClient.publish.mockClear();

    screenHandlers.get("track-ended")?.();
    await vi.waitFor(() => expect(client.sharingScreen).toBe(false));

    expect(rtcClient.publish).toHaveBeenCalledWith(camera);
    expect(onLocalScreen).toHaveBeenLastCalledWith(null);
  });

  it("is a no-op when nothing is shared", async () => {
    const { client } = await joined();
    await client.stopScreenShare();
    expect(rtcClient.unpublish).not.toHaveBeenCalled();
    expect(rtcClient.publish).not.toHaveBeenCalled();
  });

  it("leave() releases a shared screen too", async () => {
    const { client } = await joined();
    await client.startScreenShare();
    await client.leave();
    expect(screen.close).toHaveBeenCalled();
    expect(camera.close).toHaveBeenCalled();
  });
});
