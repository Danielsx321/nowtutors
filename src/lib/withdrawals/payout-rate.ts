/**
 * Credits → USD at withdrawal (SPEC §7.11, §4.7 `payout_usd_per_credit`;
 * Phase 8 Part 2).
 *
 * **One implementation, integer arithmetic only.** `withdrawal_requests.amount_usd`
 * is what an admin actually sends through PayPal, so a float residue here
 * (`23 × 1.333 = 30.658999999999995`) would be a wrong payout, not a rounding
 * curiosity. The rate is held as an integer count of 1/10,000 USD, the credit
 * count is an integer, and their product is an exact integer number of
 * hundredths of a cent. Only then is it rounded, once, to the cent.
 *
 * **Rounding is half-up to the cent.** The difference is at most half a cent
 * per request either way; half-up is what a person checking the number by hand
 * would expect, and it is stated here so nobody re-derives it.
 *
 * **The rate has no default.** §18 removed `credit_usd_rate` and no payout rate
 * was agreed when this shipped, so a missing or malformed setting parses to
 * `null` and the request action refuses (`payout_rate_unset`). Paying at a
 * guessed rate is the one outcome this module exists to rule out.
 */

/** Decimal places a payout rate may carry. More is refused, not truncated. */
export const PAYOUT_RATE_MAX_DECIMALS = 4;
const RATE_SCALE = 10 ** PAYOUT_RATE_MAX_DECIMALS;

/**
 * A usable payout rate, or `null`. Positive, finite, at most four decimal
 * places. A value with more precision than that is refused rather than
 * silently rounded, because the rounding would change what every tutor is paid.
 */
export function parsePayoutRate(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  const scaled = value * RATE_SCALE;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-6) return null;
  return value;
}

/** Integer cents for `credits` at `rate`, half-up. Throws on invalid input. */
export function creditsToPayoutCents(credits: number, rate: number): number {
  if (!Number.isInteger(credits) || credits < 0) {
    throw new Error("Credits must be a non-negative integer.");
  }
  if (parsePayoutRate(rate) === null) {
    throw new Error("Payout rate must be positive with at most 4 decimals.");
  }
  const rateUnits = Math.round(rate * RATE_SCALE); // 1/10,000 USD per credit
  const hundredthsOfCent = credits * rateUnits;
  return Math.floor((hundredthsOfCent + 50) / 100);
}

/** `3066` → `"30.66"`, the `numeric(10,2)` text form. */
export function centsToUsdString(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error("Cents must be a non-negative integer.");
  }
  const whole = Math.floor(cents / 100);
  const part = cents % 100;
  return `${whole}.${part.toString().padStart(2, "0")}`;
}

/** A USD setting such as `min_withdrawal_usd = 30` in integer cents. */
export function usdToCents(usd: number): number {
  if (!Number.isFinite(usd) || usd < 0) {
    throw new Error("USD amount must be a non-negative number.");
  }
  return Math.round(usd * 100);
}
