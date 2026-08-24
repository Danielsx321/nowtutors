import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `SessionClient.toggleMic` / `toggleCamera` / `renewToken` (SPEC §9,
 * deferred from Part 3B's #34).
 *
 * The SDK is mocked rather than loaded for real: `agora-rtc-sdk-ng` touches
 * `window` at module scope (the client wrapper's own module doc explains why
 * it is dynamically imported), which this Node test environment does not
 * have. Mocking it is also the more precise test — these three methods are
 * about what `SessionClient` does with the tracks and client it already
 * holds, not about the SDK's own behaviour.
 */

const mic = { setEnabled: vi.fn().mockResolvedValue(undefined) };
const camera = { setEnabled: vi.fn().mockResolvedValue(undefined) };
const rtcClient = {
  join: vi.fn().mockResolvedValue(undefined),
  publish: vi.fn().mockResolvedValue(undefined),
  leave: vi.fn().mockResolvedValue(undefined),
  renewToken: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  removeAllListeners: vi.fn(),
};

vi.mock("agora-rtc-sdk-ng", () => ({
  default: {
    createClient: vi.fn(() => rtcClient),
    createMicrophoneAndCameraTracks: vi.fn().mockResolvedValue([mic, camera]),
    createMicrophoneAudioTrack: vi.fn().mockResolvedValue(mic),
  },
}));

const GRANT_BASE = {
  token: "tok",
  uid: 1,
  appId: "app",
  channel: "session_x",
  expiresAt: new Date().toISOString(),
};

async function joinedTutorClient() {
  const { SessionClient } = await import("@/lib/agora/client");
  const onError = vi.fn();
  const client = new SessionClient({ onError });
  await client.join({ ...GRANT_BASE, isTutor: true });
  return { client, onError };
}

async function joinedStudentClient() {
  const { SessionClient } = await import("@/lib/agora/client");
  const client = new SessionClient();
  await client.join({ ...GRANT_BASE, isTutor: false });
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  rtcClient.join.mockResolvedValue(undefined);
  rtcClient.publish.mockResolvedValue(undefined);
  rtcClient.leave.mockResolvedValue(undefined);
  rtcClient.renewToken.mockResolvedValue(undefined);
  mic.setEnabled.mockResolvedValue(undefined);
  camera.setEnabled.mockResolvedValue(undefined);
});

describe("toggleMic", () => {
  it("starts enabled and flips on each call", async () => {
    const { client } = await joinedTutorClient();

    expect(await client.toggleMic()).toBe(false);
    expect(mic.setEnabled).toHaveBeenLastCalledWith(false);

    expect(await client.toggleMic()).toBe(true);
    expect(mic.setEnabled).toHaveBeenLastCalledWith(true);
  });

  it("rolls back and reports the error if the SDK call throws", async () => {
    const { client, onError } = await joinedTutorClient();
    const err = new Error("device lost");
    mic.setEnabled.mockRejectedValueOnce(err);

    const result = await client.toggleMic();

    expect(result).toBe(true); // rolled back to the pre-toggle state
    expect(onError).toHaveBeenCalledWith(err);
  });
});

describe("toggleCamera", () => {
  it("flips for a tutor, who has a camera track", async () => {
    const { client } = await joinedTutorClient();

    expect(await client.toggleCamera()).toBe(false);
    expect(camera.setEnabled).toHaveBeenLastCalledWith(false);
    expect(await client.toggleCamera()).toBe(true);
  });

  it("is a no-op returning null for a student — no camera track exists (§9)", async () => {
    const client = await joinedStudentClient();

    const result = await client.toggleCamera();

    expect(result).toBeNull();
    expect(camera.setEnabled).not.toHaveBeenCalled();
  });
});

describe("renewToken", () => {
  it("swaps the token on the live client without leaving the channel", async () => {
    const { client } = await joinedTutorClient();

    await client.renewToken("fresh-token");

    expect(rtcClient.renewToken).toHaveBeenCalledWith("fresh-token");
    expect(rtcClient.leave).not.toHaveBeenCalled();
  });

  it("is a no-op before join completes or after leave", async () => {
    const { SessionClient } = await import("@/lib/agora/client");
    const idle = new SessionClient();
    await idle.renewToken("token");
    expect(rtcClient.renewToken).not.toHaveBeenCalled();

    const { client } = await joinedTutorClient();
    await client.leave();
    await client.renewToken("token");
    expect(rtcClient.renewToken).not.toHaveBeenCalled();
  });
});
