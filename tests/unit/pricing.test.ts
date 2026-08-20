import { describe, it, expect } from "vitest";
import { sessionPriceCredits } from "@/lib/credits/pricing";

describe("sessionPriceCredits — hourly_rate × duration / 60, rounded up", () => {
  it("exact hours are the rate × hours", () => {
    expect(sessionPriceCredits(40, 60)).toBe(40); // 1 hour
    expect(sessionPriceCredits(40, 120)).toBe(80); // 2 hours
    expect(sessionPriceCredits(240, 60)).toBe(240);
  });

  it("the 30 / 60 / 90 fixed menu at rate 40", () => {
    expect(sessionPriceCredits(40, 30)).toBe(20);
    expect(sessionPriceCredits(40, 60)).toBe(40);
    expect(sessionPriceCredits(40, 90)).toBe(60);
  });

  it("rounds UP on a fractional credit", () => {
    expect(sessionPriceCredits(25, 90)).toBe(38); // 37.5 → 38
    expect(sessionPriceCredits(55, 30)).toBe(28); // 27.5 → 28
    expect(sessionPriceCredits(10, 45)).toBe(8); //  7.5 → 8
    expect(sessionPriceCredits(20, 90)).toBe(30); // 30.0 → 30 (no rounding)
  });

  it("minimum sane values never round to 0 for a real session", () => {
    expect(sessionPriceCredits(1, 30)).toBe(1); // 0.5 → 1
    expect(sessionPriceCredits(1, 1)).toBe(1); // 0.0166… → 1
    expect(sessionPriceCredits(1, 90)).toBe(2); // 1.5 → 2
  });

  it("a zero rate is zero (edge, not a real tutor)", () => {
    expect(sessionPriceCredits(0, 60)).toBe(0);
  });
});
