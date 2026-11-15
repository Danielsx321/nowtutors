import "server-only";
import type { AwardedRow } from "@/lib/availability-bonus/award";
import { formatHours, formatMonth } from "@/lib/availability-bonus/month";
import { centsToUsdString, creditsToPayoutCents } from "@/lib/withdrawals/payout-rate";
import { getWithdrawalSettings } from "@/lib/settings";
import type { EmailRequest } from "./types";

/**
 * One `availability-bonus-paid` email per award that moved credits (SPEC §11;
 * availability-bonus, monthly since 2026-11-15). The dollar line uses the payout rate the tutor will actually be
 * paid at, and is left out when no rate is set rather than guessed.
 */
export async function availabilityBonusEmails(awarded: ReadonlyArray<AwardedRow>): Promise<EmailRequest[]> {
  if (awarded.length === 0) return [];
  const { payoutUsdPerCredit } = await getWithdrawalSettings();
  return awarded.map((a) => ({
    type: "availability-bonus-paid",
    to: { userId: a.tutorId },
    props: {
      credits: a.credits,
      amountUsd:
        payoutUsdPerCredit == null
          ? null
          : centsToUsdString(creditsToPayoutCents(a.credits, payoutUsdPerCredit)),
      monthLabel: formatMonth(a.monthStart),
      hoursLabel: formatHours(a.liveSeconds),
      weeklyCreditsDeducted: a.weeklyCreditsDeducted,
    },
  }));
}
