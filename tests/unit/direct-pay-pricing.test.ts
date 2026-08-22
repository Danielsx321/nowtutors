import { describe, it, expect } from "vitest";
import {
  directPayAmount,
  directPayUsdCents,
  DirectPayBasisError,
  parseCreditPackages,
  requireDirectPayBasisPackage,
  type CreditPackage,
} from "@/lib/credits/packages";
import { sessionPriceCredits } from "@/lib/credits/pricing";
import { seededSetting } from "@/db/platform-settings-defaults";

/**
 * Direct-pay pricing (SPEC §7.6, §4.4). A booking has no USD price of its own —
 * credits are the unit of account and USD exists only where credits are sold —
 * so direct-pay is buy-then-spend: the order mints exactly the credits the
 * booking costs, priced at ONE designated basis tier's per-credit rate.
 *
 * The two things that must not drift: the basis is resolved from an explicit
 * flag (never an index or a runtime median), and a fractional cent rounds UP.
 */

function pkg(over: Partial<CreditPackage> = {}): CreditPackage {
  return {
    id: "popular",
    name: "Popular",
    credits: 30,
    priceUsd: 39.99,
    isDirectPayBasis: true,
    ...over,
  };
}

const SEEDED = parseCreditPackages(seededSetting<unknown>("credit_packages"));

describe("direct-pay basis — resolved from the flag, and only the flag", () => {
  it("picks the flagged package, not another tier and not by position", () => {
    const basis = requireDirectPayBasisPackage(SEEDED);
    expect(basis.id).toBe("popular");
    expect(basis.isDirectPayBasis).toBe(true);
    // Not the first, not the last, not the cheapest per credit.
    expect(basis.id).not.toBe(SEEDED[0].id);
    expect(basis.id).not.toBe(SEEDED[SEEDED.length - 1].id);
  });

  it("prices from the basis tier, not from any other tier", () => {
    const basis = requireDirectPayBasisPackage(SEEDED);
    // 30 credits at the basis is exactly the basis package price.
    expect(directPayAmount(30, basis)).toBe("39.99");

    // Every other tier would give a different answer for the same credits —
    // which is the point of pinning the basis explicitly.
    for (const other of SEEDED.filter((p) => !p.isDirectPayBasis)) {
      expect(directPayAmount(30, other)).not.toBe("39.99");
    }
  });

  it("is deliberately dearer per credit than the largest tier", () => {
    const basis = requireDirectPayBasisPackage(SEEDED);
    const premium = SEEDED.find((p) => p.id === "premium")!;
    const perCredit = (p: CreditPackage) => p.priceUsd / p.credits;
    // Buying credits in bulk must stay cheaper than paying per session,
    // otherwise the packages lose their volume incentive.
    expect(perCredit(basis)).toBeGreaterThan(perCredit(premium));
  });
});

describe("direct-pay basis — a broken basis throws, never mis-prices", () => {
  it("throws when NO package is flagged", () => {
    const packages = [pkg({ isDirectPayBasis: false })];
    expect(() => requireDirectPayBasisPackage(packages)).toThrow(DirectPayBasisError);
    expect(() => requireDirectPayBasisPackage([])).toThrow(DirectPayBasisError);
  });

  it("throws when TWO packages are flagged — no first-match-wins fallback", () => {
    const packages = [
      pkg({ id: "popular" }),
      pkg({ id: "pro", credits: 60, priceUsd: 67.99 }),
    ];
    expect(() => requireDirectPayBasisPackage(packages)).toThrow(DirectPayBasisError);
    try {
      requireDirectPayBasisPackage(packages);
    } catch (err) {
      expect((err as DirectPayBasisError).found).toBe(2);
    }
  });

  it("reads the flag off the raw settings shape", () => {
    const parsed = parseCreditPackages([
      { id: "a", name: "A", credits: 10, price_usd: 20 },
      { id: "b", name: "B", credits: 30, price_usd: 39.99, is_direct_pay_basis: true },
    ]);
    expect(requireDirectPayBasisPackage(parsed).id).toBe("b");
    expect(parsed[0].isDirectPayBasis).toBe(false);
  });
});

describe("direct-pay rounding — a fractional cent never rounds down", () => {
  it("rounds up to the cent", () => {
    const basis = pkg(); // $39.99 / 30 credits = 133.3¢ per credit
    expect(directPayUsdCents(1, basis)).toBe(134); // 133.3 → 134, not 133
    expect(directPayAmount(1, basis)).toBe("1.34");

    expect(directPayUsdCents(7, basis)).toBe(934); // 933.1 → 934
    expect(directPayAmount(7, basis)).toBe("9.34");
  });

  it("is exact when the credits divide the basis evenly", () => {
    const basis = pkg();
    // No rounding to do: 30 credits is exactly the basis package.
    expect(directPayUsdCents(30, basis)).toBe(3999);
    expect(directPayAmount(30, basis)).toBe("39.99");
    // 60 credits is exactly twice.
    expect(directPayAmount(60, basis)).toBe("79.98");
  });

  it("never loses a cent to binary float error", () => {
    const basis = pkg();
    // 30 * 39.99 * 100 / 30 evaluates to 3999.000000000001 in float, which
    // would ceil to $40.00. Integer-cent arithmetic keeps it at $39.99.
    expect(directPayAmount(30, basis)).not.toBe("40.00");

    // Sweep a range and assert the result is always within a cent above the
    // exact rational price, never below it.
    for (let credits = 1; credits <= 200; credits++) {
      const cents = directPayUsdCents(credits, basis);
      const exact = (credits * 3999) / 30;
      expect(cents).toBeGreaterThanOrEqual(exact - 1e-9);
      expect(cents).toBeLessThan(exact + 1);
    }
  });

  it("rejects a non-positive or fractional credit amount", () => {
    const basis = pkg();
    for (const bad of [0, -5, 2.5, Number.NaN]) {
      expect(() => directPayUsdCents(bad, basis)).toThrow();
    }
  });
});

describe("direct-pay credits — re-derived from the pricing formula", () => {
  it("uses sessionPriceCredits, so it matches the credits path exactly", () => {
    // A 90-minute session with a 20 credits/hr tutor is 30 credits either way.
    expect(sessionPriceCredits(20, 90)).toBe(30);
    const basis = requireDirectPayBasisPackage(SEEDED);
    expect(directPayAmount(sessionPriceCredits(20, 90), basis)).toBe("39.99");
  });

  it("ignores any client-supplied amount — price comes from rate × duration", () => {
    const basis = requireDirectPayBasisPackage(SEEDED);
    const tamperedClientAmount = 1; // "I'll pay $0.01"
    const derived = sessionPriceCredits(20, 60); // 20 credits
    expect(derived).toBe(20);
    expect(directPayAmount(derived, basis)).toBe("26.66");
    expect(directPayAmount(derived, basis)).not.toBe(
      tamperedClientAmount.toFixed(2),
    );
  });
});
