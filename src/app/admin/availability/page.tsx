import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { safeTimeZone } from "@/db/queries/admin-overview";
import { listAdminMonthlyAwards, listAdminMonthProgress } from "@/db/queries/availability-bonus";
import { getAvailabilityBonusSettings } from "@/lib/settings";
import { formatMonth, monthStartUtc } from "@/lib/availability-bonus/month";
import { CRON_JOB_INFO } from "@/lib/cron/job-names";
import { Alert } from "@/components/ui/alert";
import { StatCard } from "@/components/ui/stat-card";
import { CronRunNow } from "@/components/features/admin/cron-run-now";
import { MonthlyAwardsTable, MonthProgressTable } from "@/components/features/admin/availability-table";

export const metadata = { title: "Availability bonus · NowTutors" };
export const dynamic = "force-dynamic";

/**
 * `/admin/availability` (SPEC §6, §7.5, §12; availability-bonus, monthly since
 * 2026-11-15): every approved tutor's live hours this month against the
 * threshold, the months already paid, and a "run now" for the job on the 1st.
 *
 * `requireRole('admin')` first, independently of the layout (§5 Layer 2).
 */
export default async function AdminAvailabilityPage() {
  const { user } = await requireRole("admin");
  const now = new Date();
  const monthStart = monthStartUtc(now);

  const [settings, progress, awards, [me]] = await Promise.all([
    getAvailabilityBonusSettings(),
    listAdminMonthProgress(monthStart),
    listAdminMonthlyAwards(),
    db.select({ timezone: profiles.timezone }).from(profiles).where(eq(profiles.id, user.id)).limit(1),
  ]);

  const minSeconds = Math.round(settings.minHours * 3600);
  const onTrack = progress.filter((r) => r.liveSeconds >= minSeconds).length;
  const monthsPaid = new Set(awards.map((a) => a.monthStart)).size;
  const creditsPaid = awards.reduce((sum, a) => sum + a.credits, 0);

  return (
    <div className="w-full space-y-8 py-2">
      <div>
        <h1 className="font-display text-[clamp(28px,3vw,38px)] font-medium leading-tight tracking-[-0.03em] text-text">
          Availability bonus
        </h1>
        <p className="mt-1 text-body text-text-muted">
          {settings.credits} credits to every approved tutor who is live {settings.minHours} hours in a calendar month
          (UTC), paid on the 1st after the month ends. Amount and threshold are in{" "}
          <Link href="/admin/settings" className="focus-ring text-accent">
            settings
          </Link>
          .
        </p>
      </div>

      {!settings.enabled && (
        <Alert variant="warning" title="The bonus is switched off">
          Hours still count, but the job on the 1st pays nothing until <code>availability_bonus_enabled</code> is true
          in platform settings.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Tutors live this month" value={progress.length} hint={formatMonth(monthStart)} />
        <StatCard label="Reached the target" value={onTrack} hint={`${settings.minHours} hours live`} />
        <StatCard label="Credits paid so far" value={creditsPaid.toLocaleString()} hint={`${monthsPaid} ${monthsPaid === 1 ? "month" : "months"} paid`} />
      </div>

      <section aria-labelledby="this-month" className="space-y-4">
        <h2 id="this-month" className="text-h2 font-bold text-text">
          This month, {formatMonth(monthStart)}
        </h2>
        <MonthProgressTable rows={progress} minSeconds={minSeconds} />
      </section>

      <section aria-labelledby="paid" className="space-y-4">
        <h2 id="paid" className="text-h2 font-bold text-text">
          Paid
        </h2>
        <MonthlyAwardsTable rows={awards} timeZone={safeTimeZone(me?.timezone)} />
      </section>

      <section aria-labelledby="run" className="space-y-4">
        <div>
          <h2 id="run" className="text-h2 font-bold text-text">
            Run the monthly job now
          </h2>
          <p className="mt-1 text-body text-text-muted">
            Pays any complete month from the last three (never before November 2026) that has not been paid yet.
            Safe to run twice: a month is paid once per tutor.
          </p>
        </div>
        <CronRunNow jobs={[{ name: "availability-bonus", ...CRON_JOB_INFO["availability-bonus"] }]} />
      </section>
    </div>
  );
}
