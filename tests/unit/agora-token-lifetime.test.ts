import { describe, expect, it } from "vitest";
import {
  DEADLINE_GRACE_SECONDS,
  sessionTokenLifetime,
  TOKEN_TTL_SECONDS,
} from "@/lib/agora/token-request";

/**
 * A session token must not outlive the session it was issued for (SPEC §7.4;
 * code review 2026-09-20, T1). Every token used to last 3,600 seconds whatever
 * was booked, so a 30-minute session's token worked for 60, and the hard stop
 * depended on the client choosing to leave.
 */

const NOW = new Date("2026-09-21T10:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe("sessionTokenLifetime", () => {
  it("caps a started session's token at the time left plus a short grace", () => {
    // 30-minute session, 10 minutes in: 20 minutes left.
    const life = sessionTokenLifetime({ startedAt: minutesAgo(10), durationMinutes: 30 }, NOW);
    expect(life.ttlSeconds).toBe(20 * 60 + DEADLINE_GRACE_SECONDS);
    // Nothing to renew into: the next ask is at the deadline, and is refused.
    expect(life.renewAfterSeconds).toBe(20 * 60);
  });

  it("never issues more than the default lifetime, however long is left", () => {
    const life = sessionTokenLifetime({ startedAt: minutesAgo(1), durationMinutes: 120 }, NOW);
    expect(life.ttlSeconds).toBe(TOKEN_TTL_SECONDS);
    expect(life.renewAfterSeconds).toBeLessThan(TOKEN_TTL_SECONDS);
  });

  it("before the pair has met, lasts the booked duration at most", () => {
    // The clock starts when both are present, which is never before this join,
    // so a token lasting `duration` from now cannot outlive the deadline.
    const life = sessionTokenLifetime({ startedAt: null, durationMinutes: 30 }, NOW);
    expect(life.ttlSeconds).toBe(30 * 60);
    expect(life.renewAfterSeconds).toBeGreaterThan(0);
    expect(life.renewAfterSeconds).toBeLessThan(life.ttlSeconds);
  });

  it("in the last seconds, still issues a usable token and does not ask for an instant renewal", () => {
    const life = sessionTokenLifetime(
      { startedAt: new Date(NOW.getTime() - (30 * 60 - 5) * 1000), durationMinutes: 30 },
      NOW,
    );
    expect(life.ttlSeconds).toBe(5 + DEADLINE_GRACE_SECONDS);
    expect(life.renewAfterSeconds).toBe(5);
  });

  it("falls back to the default when the booking has no duration", () => {
    const life = sessionTokenLifetime({ startedAt: null, durationMinutes: null }, NOW);
    expect(life.ttlSeconds).toBe(TOKEN_TTL_SECONDS);
  });
});
