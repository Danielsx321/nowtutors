// Authoritative earnings split (SPEC §7.11). Single source of truth for how a
// gross credit charge divides into the platform fee and the tutor's net earnings,
// so the seed fixtures and the Phase 5 earnings pipeline cannot pick different
// rounding and diverge.
//
// Rule: the fee rounds DOWN; the remainder goes to the tutor.
//   fee = floor(gross * platform_fee_percent / 100), net = gross - fee.
// Rationale: rounding against the payee accumulates in the platform's favour
// across many small sessions. Rounding down costs the platform fractions of a
// credit and is the defensible direction. (DECISIONS: "fee rounds down".)

export type EarningsSplit = {
  grossCredits: number;
  platformFeeCredits: number;
  netCredits: number;
};

/**
 * Split a gross credit amount into platform fee + tutor net.
 * @param grossCredits whole credits the student was charged for the session
 * @param platformFeePercent the `platform_fee_percent` platform setting (e.g. 25)
 */
export function splitEarnings(
  grossCredits: number,
  platformFeePercent: number,
): EarningsSplit {
  const platformFeeCredits = Math.floor((grossCredits * platformFeePercent) / 100);
  const netCredits = grossCredits - platformFeeCredits;
  return { grossCredits, platformFeeCredits, netCredits };
}
