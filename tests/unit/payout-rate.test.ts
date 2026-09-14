import { describe, expect, it } from "vitest";
import {
  centsToUsdString,
  creditsToPayoutCents,
  parsePayoutRate,
  usdToCents,
} from "@/lib/withdrawals/payout-rate";

/**
 * Credits → USD at withdrawal (SPEC §7.11; Phase 8 Part 2). Every expected
 * number is pinned literally, and the fixtures are chosen so truncation,
 * banker's rounding and float arithmetic each give a different answer from
 * half-up integer arithmetic.
 */

describe("parsePayoutRate", () => {
  it("accepts a positive rate with up to four decimals", () => {
    expect(parsePayoutRate(1)).toBe(1);
    expect(parsePayoutRate(1.3333)).toBe(1.3333);
    expect(parsePayoutRate(0.0001)).toBe(0.0001);
  });

  it("refuses anything that would have to be guessed at", () => {
    expect(parsePayoutRate(undefined)).toBeNull();
    expect(parsePayoutRate(null)).toBeNull();
    expect(parsePayoutRate("1.33")).toBeNull();
    expect(parsePayoutRate(0)).toBeNull();
    expect(parsePayoutRate(-1)).toBeNull();
    expect(parsePayoutRate(Number.NaN)).toBeNull();
    expect(parsePayoutRate(Number.POSITIVE_INFINITY)).toBeNull();
    // Five decimals is refused, not rounded: rounding would change every payout.
    expect(parsePayoutRate(1.33333)).toBeNull();
  });
});

describe("creditsToPayoutCents", () => {
  it("rounds half-up to the cent, not down", () => {
    // 23 × 1.3333 = 30.6659 → 30.67. Truncation would give 30.66.
    expect(creditsToPayoutCents(23, 1.3333)).toBe(3067);
  });

  it("uses integer arithmetic, so float residue never reaches a payout", () => {
    // 23 × 1.333 in floats is 30.658999999999995.
    expect(creditsToPayoutCents(23, 1.333)).toBe(3066);
    // 0.1 × 3 in floats is 0.30000000000000004.
    expect(creditsToPayoutCents(3, 0.1)).toBe(30);
  });

  it("puts exactly half a cent up and just under half a cent down", () => {
    expect(creditsToPayoutCents(1, 0.005)).toBe(1);
    expect(creditsToPayoutCents(1, 0.0049)).toBe(0);
  });

  it("is zero for zero credits and refuses bad input", () => {
    expect(creditsToPayoutCents(0, 1.5)).toBe(0);
    expect(() => creditsToPayoutCents(1.5, 1)).toThrow();
    expect(() => creditsToPayoutCents(-1, 1)).toThrow();
    expect(() => creditsToPayoutCents(10, 0)).toThrow();
    expect(() => creditsToPayoutCents(10, 1.00001)).toThrow();
  });
});

describe("cents and USD strings", () => {
  it("formats numeric(10,2) text", () => {
    expect(centsToUsdString(0)).toBe("0.00");
    expect(centsToUsdString(5)).toBe("0.05");
    expect(centsToUsdString(3000)).toBe("30.00");
    expect(centsToUsdString(3067)).toBe("30.67");
    expect(() => centsToUsdString(1.5)).toThrow();
  });

  it("converts a USD setting to cents", () => {
    expect(usdToCents(30)).toBe(3000);
    expect(usdToCents(29.99)).toBe(2999);
    expect(() => usdToCents(-1)).toThrow();
  });
});
