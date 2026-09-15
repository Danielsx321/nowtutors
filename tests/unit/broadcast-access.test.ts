import { describe, expect, it } from "vitest";
import {
  BROADCAST_NOT_LIVE,
  broadcastChannel,
  checkBroadcastAccess,
  type BroadcastAccessRow,
} from "@/lib/broadcasts/access";

/**
 * Who gets a broadcast token, and as what (SPEC §9 step 3; Phase 9 Part 3).
 * The properties: only the host publishes, a viewer needs a fresh host, every
 * "can't watch" looks the same from outside, and a row whose channel isn't its
 * own `broadcast_{id}` gets nobody a token.
 */

const HOST = "11111111-1111-4111-8111-111111111111";
const VIEWER = "22222222-2222-4222-8222-222222222222";
const ID = "33333333-3333-4333-8333-333333333333";

function row(over: Partial<BroadcastAccessRow> = {}): BroadcastAccessRow {
  return {
    id: ID,
    tutorId: HOST,
    status: "live",
    agoraChannel: broadcastChannel(ID),
    hostFresh: true,
    ...over,
  };
}

describe("broadcast access", () => {
  it("gives the host of a live broadcast a publisher token", () => {
    expect(checkBroadcastAccess(row(), HOST)).toEqual({
      ok: true,
      broadcastId: ID,
      channel: `broadcast_${ID}`,
      isHost: true,
      role: "publisher",
    });
  });

  it("lets the host rejoin while their presence is catching up", () => {
    expect(checkBroadcastAccess(row({ hostFresh: false }), HOST)).toMatchObject({
      ok: true,
      role: "publisher",
    });
  });

  it("gives a signed-in viewer a subscriber token while the host is fresh", () => {
    expect(checkBroadcastAccess(row(), VIEWER)).toEqual({
      ok: true,
      broadcastId: ID,
      channel: `broadcast_${ID}`,
      isHost: false,
      role: "subscriber",
    });
  });

  it("never gives anyone but the host a publisher token", () => {
    const access = checkBroadcastAccess(row(), VIEWER);
    expect(access.ok && access.role).toBe("subscriber");
  });

  it("refuses a viewer when the host has gone stale", () => {
    expect(checkBroadcastAccess(row({ hostFresh: false }), VIEWER)).toEqual({
      ok: false,
      status: 404,
      message: BROADCAST_NOT_LIVE,
    });
  });

  it("answers missing, ended and stale-host identically", () => {
    const missing = checkBroadcastAccess(null, VIEWER);
    const ended = checkBroadcastAccess(row({ status: "ended" }), VIEWER);
    const stale = checkBroadcastAccess(row({ hostFresh: false }), VIEWER);
    expect(ended).toEqual(missing);
    expect(stale).toEqual(missing);
  });

  it("refuses the host too once the broadcast has ended", () => {
    expect(checkBroadcastAccess(row({ status: "ended" }), HOST)).toMatchObject({ ok: false, status: 404 });
  });

  it("refuses everyone when the channel isn't broadcast_{id} (a session channel, say)", () => {
    const spoofed = row({ agoraChannel: "session_44444444-4444-4444-8444-444444444444" });
    expect(checkBroadcastAccess(spoofed, HOST)).toMatchObject({ ok: false, status: 500 });
    expect(checkBroadcastAccess(spoofed, VIEWER)).toMatchObject({ ok: false, status: 500 });
  });

  it("refuses another broadcast's channel", () => {
    const other = row({ agoraChannel: broadcastChannel("55555555-5555-4555-8555-555555555555") });
    expect(checkBroadcastAccess(other, VIEWER)).toMatchObject({ ok: false });
  });
});
