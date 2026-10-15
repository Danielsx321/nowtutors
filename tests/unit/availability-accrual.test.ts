import { describe, expect, it } from "vitest";
import { ACCRUAL_CAP_SECONDS, secondsToAccrue } from "@/lib/availability-bonus/accrual";
import { PRESENCE_STALE_SECONDS } from "@/lib/presence/staleness";

/**
 * What one heartbeat adds to a live tutor's day (SPEC §7.5; availability-bonus).
 * The cap is the presence staleness window, so a gap the view would have
 * called "gone" is never paid for.
 */
describe("secondsToAccrue", () => {
  const now = new Date("2026-10-14T10:00:00Z");

  it("adds nothing on the first beat (no previous beat to measure from)", () => {
    expect(secondsToAccrue(null, now)).toBe(0);
    expect(secondsToAccrue(undefined, now)).toBe(0);
  });

  it("adds the gap for a normal 30-second beat", () => {
    expect(secondsToAccrue(new Date("2026-10-14T09:59:30Z"), now)).toBe(30);
  });

  it("floors part seconds", () => {
    expect(secondsToAccrue(new Date("2026-10-14T09:59:29.400Z"), now)).toBe(30);
  });

  it("caps a long gap at the staleness window", () => {
    expect(secondsToAccrue(new Date("2026-10-14T09:00:00Z"), now)).toBe(PRESENCE_STALE_SECONDS);
    expect(ACCRUAL_CAP_SECONDS).toBe(PRESENCE_STALE_SECONDS);
  });

  it("a gap exactly at the window is credited in full", () => {
    expect(secondsToAccrue(new Date("2026-10-14T09:58:00Z"), now)).toBe(120);
  });

  it("clock skew backwards adds nothing", () => {
    expect(secondsToAccrue(new Date("2026-10-14T10:00:05Z"), now)).toBe(0);
  });

  it("honours an explicit cap", () => {
    expect(secondsToAccrue(new Date("2026-10-14T09:59:00Z"), now, 45)).toBe(45);
  });
});
