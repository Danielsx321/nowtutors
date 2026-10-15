import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { safeTimeZone } from "@/db/queries/admin-overview";
import { listAdminAwards, listAdminWeekProgress } from "@/db/queries/availability-bonus";
import { getAvailabilityBonusSettings } from "@/lib/settings";
import { formatWeekRange, weekStartUtc } from "@/lib/availability-bonus/week";
import { CRON_JOB_INFO } from "@/lib/cron/job-names";
import { Alert } from "@/components/ui/alert";
import { StatCard } from "@/components/ui/stat-card";
import { CronRunNow } from "@/components/features/admin/cron-run-now";
import { AwardsTable, WeekProgressTable } from "@/components/features/admin/availability-table";

export const metadata = { title: "Availability bonus · NowTutors" };
export const dynamic = "force-dynamic";

/**
 * `/admin/availability` (SPEC §6, §7.5, §12; availability-bonus, 2026-10-14):
 * every approved tutor's live hours this week against the threshold, the
 * weeks already paid, and a "run now" for the Monday job.
 *
 * `requireRole('admin')` first, independently of the layout (§5 Layer 2).
 */
export default async function AdminAvailabilityPage() {
  const { user } = await requireRole("admin");
  const now = new Date();
  const weekStart = weekStartUtc(now);

  const [settings, progress, awards, [me]] = await Promise.all([
    getAvailabilityBonusSettings(),
    listAdminWeekProgress(weekStart),
    listAdminAwards(),
    db.select({ timezone: profiles.timezone }).from(profiles).where(eq(profiles.id, user.id)).limit(1),
  ]);

  const minSeconds = Math.round(settings.minHours * 3600);
  const onTrack = progress.filter((r) => r.liveSeconds >= minSeconds).length;
  const weeksPaid = new Set(awards.map((a) => a.weekStart)).size;
  const creditsPaid = awards.reduce((sum, a) => sum + a.credits, 0);

  return (
    <div className="w-full space-y-8 py-2">
      <div>
        <h1 className="font-display text-[clamp(28px,3vw,38px)] font-medium leading-tight tracking-[-0.03em] text-text">
          Availability bonus
        </h1>
        <p className="mt-1 text-body text-text-muted">
          {settings.credits} credits to every approved tutor who is live {settings.minHours} hours in a Monday-to-Sunday
          week (UTC), paid by the Monday job. Amount and threshold are in{" "}
          <Link href="/admin/settings" className="focus-ring text-accent">
            settings
          </Link>
          .
        </p>
      </div>

      {!settings.enabled && (
        <Alert variant="warning" title="The bonus is switched off">
          Hours still count, but the Monday job pays nothing until <code>availability_bonus_enabled</code> is true
          in platform settings.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Tutors live this week" value={progress.length} hint={formatWeekRange(weekStart)} />
        <StatCard label="Reached the target" value={onTrack} hint={`${settings.minHours} hours live`} />
        <StatCard label="Credits paid so far" value={creditsPaid.toLocaleString()} hint={`${weeksPaid} ${weeksPaid === 1 ? "week" : "weeks"} paid`} />
      </div>

      <section aria-labelledby="this-week" className="space-y-4">
        <h2 id="this-week" className="text-h2 font-bold text-text">
          This week, {formatWeekRange(weekStart)}
        </h2>
        <WeekProgressTable rows={progress} minSeconds={minSeconds} />
      </section>

      <section aria-labelledby="paid" className="space-y-4">
        <h2 id="paid" className="text-h2 font-bold text-text">
          Paid
        </h2>
        <AwardsTable rows={awards} timeZone={safeTimeZone(me?.timezone)} />
      </section>

      <section aria-labelledby="run" className="space-y-4">
        <div>
          <h2 id="run" className="text-h2 font-bold text-text">
            Run the Monday job now
          </h2>
          <p className="mt-1 text-body text-text-muted">
            Pays any complete week from the last four that has not been paid yet. Safe to run twice: a week is paid
            once per tutor.
          </p>
        </div>
        <CronRunNow jobs={[{ name: "availability-bonus", ...CRON_JOB_INFO["availability-bonus"] }]} />
      </section>
    </div>
  );
}
