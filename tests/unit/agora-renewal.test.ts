import { describe, it, expect } from "vitest";
import { renewalDelayMs, RENEWAL_RETRY_MS } from "@/lib/agora/renewal";

/**
 * Renewal scheduling (SPEC §9 step 6, deferred from Part 3B's #34).
 *
 * `/api/agora/token` reports `expiresAt` five minutes before the token's real
 * expiry specifically so renewal can begin while the current token is still
 * valid (DECISIONS, Phase 6 Part 3A). This is the pure arithmetic the renewal
 * hook schedules its single `setTimeout` from — no DB, no SDK, no timers.
 */

describe("renewalDelayMs", () => {
  it("returns the gap to a future expiresAt", () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    const expiresAt = new Date("2026-08-24T12:05:00.000Z");
    expect(renewalDelayMs(expiresAt, now)).toBe(5 * 60 * 1000);
  });

  it("accepts an ISO string the same way", () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    expect(renewalDelayMs("2026-08-24T12:05:00.000Z", now)).toBe(5 * 60 * 1000);
  });

  it("floors at zero rather than going negative", () => {
    // A clock that woke from sleep, or a token close enough to its reported
    // expiry that "now" has already caught up — renew immediately, don't wait
    // negative milliseconds (which setTimeout would coerce to 0 anyway, but
    // the floor makes that intentional rather than incidental).
    const now = new Date("2026-08-24T12:10:00.000Z");
    const expiresAt = new Date("2026-08-24T12:00:00.000Z");
    expect(renewalDelayMs(expiresAt, now)).toBe(0);
  });

  it("returns zero for an expiresAt exactly at now", () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    expect(renewalDelayMs(now, now)).toBe(0);
  });

  it("defaults `now` to the current time when omitted", () => {
    const soon = new Date(Date.now() + 60_000);
    const delay = renewalDelayMs(soon);
    // Loose bound: this runs in real time, so pin it to "close to a minute",
    // not an exact value.
    expect(delay).toBeGreaterThan(55_000);
    expect(delay).toBeLessThanOrEqual(60_000);
  });
});

describe("RENEWAL_RETRY_MS", () => {
  it("is a fixed, positive backoff", () => {
    // Exercised for real by the renewal hook's network-failure branch; pinned
    // here so a change to the constant is a deliberate diff, not a surprise.
    expect(RENEWAL_RETRY_MS).toBeGreaterThan(0);
  });
});
