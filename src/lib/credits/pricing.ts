/**
 * Single session-pricing formula (SPEC §7.3 / §7.4, the credits-are-money
 * amendment). Price in credits = ceil(hourly_rate_credits × duration_minutes / 60).
 *
 * The SAME formula prices **scheduled and instant** sessions — credits are a
 * purchased currency, not a unit of time, so instant is no longer duration ÷ 3.
 * Rounds **up** so a part-hour is never billed as free fractions; both inputs are
 * whole numbers in practice (durations are the fixed 30/60/90 menu), but the ceil
 * makes any future non-hour duration safe. This is the one place the formula lives;
 * the seed and (from Phase 4/6) the booking actions both call it so they can't drift.
 */
export function sessionPriceCredits(
  hourlyRateCredits: number,
  durationMinutes: number,
): number {
  return Math.ceil((hourlyRateCredits * durationMinutes) / 60);
}
