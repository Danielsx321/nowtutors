import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { getTutorEarningsBreakdown } from "@/db/queries/withdrawals";
import { getTutorWeekProgress, listTutorAwards } from "@/db/queries/availability-bonus";
import { getAvailabilityBonusSettings, getWithdrawalSettings } from "@/lib/settings";
import { EarningsBreakdown } from "@/components/features/tutor/earnings-breakdown";
import { WeeklyBonusCard } from "@/components/features/tutor/weekly-bonus-card";

export const metadata = { title: "Earnings · NowTutors" };
export const dynamic = "force-dynamic";

/**
 * `/tutor/earnings`: held / available / withdrawn breakdown (SPEC §6, §7.11;
 * Phase 8 Part 2), plus the weekly availability bonus card (availability-bonus,
 * 2026-10-14). Read-only; the tutor id comes from the guard.
 */
export default async function TutorEarningsPage() {
  const { user } = await requireRole("tutor");

  const [breakdown, progress, awards, bonus, withdrawals, [me]] = await Promise.all([
    getTutorEarningsBreakdown(user.id),
    getTutorWeekProgress(user.id),
    listTutorAwards(user.id),
    getAvailabilityBonusSettings(),
    getWithdrawalSettings(),
    db
      .select({ timezone: profiles.timezone })
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .limit(1),
  ]);

  return (
    <div className="w-full space-y-6 py-2">
      <div>
        <h1 className="font-display text-[clamp(28px,3vw,38px)] font-medium leading-tight tracking-[-0.03em] text-text">Earnings</h1>
        <p className="mt-1 text-body text-text-muted">
          What you&apos;ve earned per session, after the platform fee.
        </p>
      </div>
      <EarningsBreakdown breakdown={breakdown} timeZone={me?.timezone ?? "UTC"} />
      <WeeklyBonusCard
        progress={progress}
        awards={awards}
        settings={bonus}
        usdPerCredit={withdrawals.payoutUsdPerCredit}
      />
    </div>
  );
}
