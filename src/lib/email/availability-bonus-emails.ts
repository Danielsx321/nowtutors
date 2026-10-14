import "server-only";
import type { AwardedRow } from "@/lib/availability-bonus/award";
import { formatHours, formatWeekRange } from "@/lib/availability-bonus/week";
import { centsToUsdString, creditsToPayoutCents } from "@/lib/withdrawals/payout-rate";
import { getWithdrawalSettings } from "@/lib/settings";
import type { EmailRequest } from "./types";

/**
 * One `availability-bonus-paid` email per award (SPEC §11; availability-bonus,
 * 2026-10-14). The dollar line uses the payout rate the tutor will actually be
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
      weekLabel: formatWeekRange(a.weekStart),
      hoursLabel: formatHours(a.liveSeconds),
    },
  }));
}
