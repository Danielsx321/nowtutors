import { describe, it, expect } from "vitest";
import {
  findCreditPackage,
  parseCreditPackages,
  requireCreditPackage,
  toPayPalAmount,
  UnknownCreditPackageError,
} from "@/lib/credits/packages";
import { seededSetting } from "@/db/platform-settings-defaults";

/**
 * Package price lookup — the "never trust a client amount" boundary (SPEC §7.6).
 * The order route sends PayPal whatever this returns, so a wrong or coercible
 * answer here is a real-money bug.
 */
describe("credit package lookup", () => {
  const seeded = parseCreditPackages(seededSetting<unknown>("credit_packages"));

  it("parses every seeded tier (§18 item 7)", () => {
    expect(seeded).toHaveLength(5);
    expect(seeded.map((p) => p.id)).toEqual([
      "starter",
      "standard",
      "popular",
      "pro",
      "premium",
    ]);
  });

  it("resolves a package id to the settings price, not a client one", () => {
    const pkg = requireCreditPackage(seeded, "popular");
    expect(pkg).toMatchObject({ credits: 30, priceUsd: 39.99, name: "Popular" });
  });

  it.each([
    ["starter", 5, 9.99],
    ["standard", 15, 24.99],
    ["popular", 30, 39.99],
    ["pro", 60, 67.99],
    ["premium", 100, 97.99],
  ])("%s is %i credits at $%f", (id, credits, priceUsd) => {
    expect(requireCreditPackage(seeded, id)).toMatchObject({ credits, priceUsd });
  });

  it("throws on an unknown id rather than falling back to a default", () => {
    expect(() => requireCreditPackage(seeded, "free")).toThrow(
      UnknownCreditPackageError,
    );
    expect(findCreditPackage(seeded, "free")).toBeNull();
  });

  it("matches ids exactly — no trimming, casing, or prefix matching", () => {
    for (const id of ["Starter", " starter", "start", "starter "]) {
      expect(findCreditPackage(seeded, id)).toBeNull();
    }
  });

  it("drops malformed rows so a bad settings edit can't become a $0 order", () => {
    const parsed = parseCreditPackages([
      { id: "ok", name: "OK", credits: 10, price_usd: 5 },
      { id: "no-price", name: "No price", credits: 10 },
      { id: "zero", name: "Zero", credits: 10, price_usd: 0 },
      { id: "negative", name: "Negative", credits: 10, price_usd: -5 },
      { id: "string-price", name: "Stringy", credits: 10, price_usd: "5.00" },
      { id: "fractional", name: "Fractional", credits: 2.5, price_usd: 5 },
      { id: "no-credits", name: "No credits", price_usd: 5 },
      { id: "", name: "Blank id", credits: 10, price_usd: 5 },
      { id: "ok", name: "Duplicate id", credits: 999, price_usd: 1 },
      null,
      "nope",
    ]);
    expect(parsed).toEqual([
      { id: "ok", name: "OK", credits: 10, priceUsd: 5, isDirectPayBasis: false },
    ]);
  });

  it("returns nothing for a non-array value", () => {
    for (const v of [null, undefined, {}, "packages", 3]) {
      expect(parseCreditPackages(v)).toEqual([]);
    }
  });

  it("formats PayPal amounts as 2-decimal strings", () => {
    expect(toPayPalAmount(9.99)).toBe("9.99");
    expect(toPayPalAmount(40)).toBe("40.00");
    expect(toPayPalAmount(67.9)).toBe("67.90");
  });
});
