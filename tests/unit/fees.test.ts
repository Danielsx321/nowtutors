import { describe, it, expect } from "vitest";
import { splitEarnings } from "@/lib/credits/fees";
import { seededSetting } from "@/db/platform-settings-defaults";

/**
 * The authoritative earnings split (SPEC §7.11).
 *
 * This module had no test until Phase 6 Part 3C, which is the pass that gave it
 * its first production caller. It is the one place that decides how a student's
 * charge divides between the platform and the tutor, and its whole content is a
 * rounding direction — the kind of rule that is invisible when wrong on a single
 * session and material across thousands.
 *
 * The properties below are asserted rather than a table of expected numbers,
 * because the specific numbers are only interesting insofar as they are examples
 * of the properties: the fee rounds DOWN, the remainder goes to the tutor, and
 * the two halves always reconstruct the gross.
 */
describe("splitEarnings — the fee rounds down, the remainder goes to the tutor", () => {
  const FEE_PERCENT = seededSetting<number>("platform_fee_percent"); // 25

  it("splits an exact multiple with nothing left over", () => {
    expect(splitEarnings(100, 25)).toEqual({
      grossCredits: 100,
      platformFeeCredits: 25,
      netCredits: 75,
    });
    expect(splitEarnings(40, 25)).toEqual({
      grossCredits: 40,
      platformFeeCredits: 10,
      netCredits: 30,
    });
  });

  it("FLOORS the fee — never rounds it up, and never rounds half up", () => {
    // 25% of 10 is 2.5. Half-up would be 3; the rule is 2.
    expect(splitEarnings(10, 25).platformFeeCredits).toBe(2);
    // 25% of 6 is 1.5 — the other half-up case.
    expect(splitEarnings(6, 25).platformFeeCredits).toBe(1);
    // 25% of 7 is 1.75, which rounds up under every scheme except this one.
    expect(splitEarnings(7, 25).platformFeeCredits).toBe(1);
    // 33% of 100 is 33.0; 33% of 101 is 33.33 — still 33.
    expect(splitEarnings(101, 33).platformFeeCredits).toBe(33);
  });

  it("gives the rounding remainder to the TUTOR, not the platform", () => {
    // The whole point of flooring: every fractional credit lands in net.
    for (const gross of [1, 3, 6, 7, 10, 13, 41, 99, 4321]) {
      const { platformFeeCredits, netCredits } = splitEarnings(gross, FEE_PERCENT);
      const exactFee = (gross * FEE_PERCENT) / 100;
      expect(platformFeeCredits).toBeLessThanOrEqual(exactFee);
      expect(netCredits).toBeGreaterThanOrEqual(gross - exactFee);
      // …and the tutor keeps at least the advertised 75% (§7.11).
      expect(netCredits / gross).toBeGreaterThanOrEqual(1 - FEE_PERCENT / 100);
    }
  });

  it("reconstructs the gross: fee + net === gross, always", () => {
    for (const gross of [0, 1, 2, 3, 5, 8, 13, 21, 100, 999, 100_000]) {
      for (const percent of [0, 1, 25, 33, 50, 99, 100]) {
        const split = splitEarnings(gross, percent);
        expect(split.platformFeeCredits + split.netCredits).toBe(gross);
        expect(split.grossCredits).toBe(gross);
        // Neither side is ever negative, at any percent in range.
        expect(split.platformFeeCredits).toBeGreaterThanOrEqual(0);
        expect(split.netCredits).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("a zero gross splits into zero and zero", () => {
    // Reachable: `bookings.price_credits` is "0 for instant until billed" (§4.3),
    // and Part 3C's sweep coalesces a null to 0 rather than skipping the row.
    expect(splitEarnings(0, 25)).toEqual({
      grossCredits: 0,
      platformFeeCredits: 0,
      netCredits: 0,
    });
    expect(splitEarnings(0, 100)).toEqual({
      grossCredits: 0,
      platformFeeCredits: 0,
      netCredits: 0,
    });
  });

  it("a gross smaller than one fee step charges no fee at all", () => {
    // A 3-credit session at 25%: 0.75 of a credit is owed and floors to zero, so
    // the platform takes nothing and the tutor keeps all three. This is the
    // direction the rule chooses on purpose — the alternative rounds a whole
    // credit off a three-credit session, a 33% haircut.
    expect(splitEarnings(3, 25)).toEqual({
      grossCredits: 3,
      platformFeeCredits: 0,
      netCredits: 3,
    });
    expect(splitEarnings(1, 25)).toEqual({
      grossCredits: 1,
      platformFeeCredits: 0,
      netCredits: 1,
    });
    // Even at 99%, one credit is indivisible and the tutor keeps it.
    expect(splitEarnings(1, 99)).toEqual({
      grossCredits: 1,
      platformFeeCredits: 0,
      netCredits: 1,
    });
  });

  it("a large gross stays exact — no float drift at scale", () => {
    expect(splitEarnings(1_000_000, 25)).toEqual({
      grossCredits: 1_000_000,
      platformFeeCredits: 250_000,
      netCredits: 750_000,
    });
    // 25% of 999,999 is 249,999.75 → floors to 249,999, remainder to the tutor.
    expect(splitEarnings(999_999, 25)).toEqual({
      grossCredits: 999_999,
      platformFeeCredits: 249_999,
      netCredits: 750_000,
    });
    const big = splitEarnings(2_147_483_647, 33);
    expect(Number.isInteger(big.platformFeeCredits)).toBe(true);
    expect(Number.isInteger(big.netCredits)).toBe(true);
    expect(big.platformFeeCredits + big.netCredits).toBe(2_147_483_647);
  });

  it("the two extremes of the percent: nothing, and everything", () => {
    expect(splitEarnings(80, 0)).toEqual({
      grossCredits: 80,
      platformFeeCredits: 0,
      netCredits: 80,
    });
    expect(splitEarnings(80, 100)).toEqual({
      grossCredits: 80,
      platformFeeCredits: 80,
      netCredits: 0,
    });
  });
});
