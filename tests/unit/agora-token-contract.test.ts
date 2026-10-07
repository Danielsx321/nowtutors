import { describe, it, expect } from "vitest";
import {
  EXPIRY_MARGIN_SECONDS,
  tokenExpiresAt,
  TOKEN_TTL_SECONDS,
} from "@/lib/agora/token-request";
import { agoraUid } from "@/lib/agora/uid";

/**
 * The reported expiry and the deterministic uid (SPEC §9 steps 4–6).
 *
 * The Render service's path and response shape used to be pinned here too; since
 * 2026-10-07 the token is built in-app and its contents are pinned by decoding it
 * in `agora-token-builder.test.ts`.
 */

describe("reported expiry", () => {
  it("is EARLIER than the token's real expiry", () => {
    // SPEC §9 step 5: report a TTL shorter than the token's, so the renewal in
    // step 6 begins while the current token is still valid.
    const issued = new Date("2026-08-24T12:00:00.000Z");
    const reported = tokenExpiresAt(issued);
    const real = new Date(issued.getTime() + TOKEN_TTL_SECONDS * 1000);

    expect(reported.getTime()).toBeLessThan(real.getTime());
    expect(real.getTime() - reported.getTime()).toBe(EXPIRY_MARGIN_SECONDS * 1000);
  });

  it("never reports an expiry in the past, even if the margin exceeds the TTL", () => {
    const issued = new Date("2026-08-24T12:00:00.000Z");
    expect(tokenExpiresAt(issued, 60, 3600).getTime()).toBeGreaterThan(issued.getTime());
  });
});

describe("deterministic uid", () => {
  const ID = "6a1c2f74-1c2b-4a3e-9d8f-1b2c3d4e5f60";

  it("returns the same uid for the same profile id", () => {
    // A reconnect must come back as the SAME participant, or the peer sees a
    // stranger arrive while the person they were talking to lingers.
    expect(agoraUid(ID)).toBe(agoraUid(ID));
  });

  it("separates different profile ids", () => {
    expect(agoraUid("student-1")).not.toBe(agoraUid("tutor-1"));
  });

  it("stays inside Agora's 1 … 2^32-1 range", () => {
    for (const id of [ID, "", "a", "tutor-1", "🙂", "x".repeat(500)]) {
      const uid = agoraUid(id);
      expect(Number.isInteger(uid)).toBe(true);
      expect(uid).toBeGreaterThanOrEqual(1);
      expect(uid).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("never returns 0 — Agora reads that as 'assign me one'", () => {
    // The one output that would silently re-enable the random uid this function
    // exists to prevent.
    expect(agoraUid("")).not.toBe(0);
  });
});
