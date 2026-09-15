import Link from "next/link";
import { eq } from "drizzle-orm";
import {
  Banknote,
  CalendarDays,
  CreditCard,
  GraduationCap,
  Scale,
  Users,
} from "lucide-react";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { getAdminOverview, safeTimeZone } from "@/db/queries/admin-overview";
import { readWalletDrift } from "@/db/queries/reconcile-wallets";
import { summarizeWalletDrift, type ReconcileSummary } from "@/lib/wallets/reconcile";
import { Alert } from "@/components/ui/alert";
import { StatCard } from "@/components/ui/stat-card";

export const metadata = { title: "Admin · NowTutors" };
export const dynamic = "force-dynamic";

const usd = (amount: string) =>
  Number(amount).toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * `/admin` overview (SPEC §6; Phase 8 Part 4). Counts only: §14 rules out
 * analytics dashboards.
 *
 * The wallet check runs the reconcile read **live on page load** rather than
 * showing the last scheduled result: the scheduled result lives in pg_net's
 * response table, which only keeps about six hours and doesn't exist on every
 * project. The read is one statement and reports, never repairs.
 *
 * `requireRole('admin')` first, independently of the layout (§5 Layer 2).
 */
export default async function AdminOverviewPage() {
  const { user } = await requireRole("admin");

  const [me] = await db
    .select({ timezone: profiles.timezone })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);
  const timeZone = safeTimeZone(me?.timezone);

  const [overview, drift] = await Promise.all([
    getAdminOverview(timeZone),
    readWalletDrift()
      .then(({ walletsChecked, rows }) => summarizeWalletDrift(walletsChecked, rows))
      .catch((err: unknown): ReconcileSummary | null => {
        console.error("[admin/overview] wallet check failed", err);
        return null;
      }),
  ]);

  const openWithdrawals = overview.withdrawalsRequested + overview.withdrawalsApproved;

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-8">
      <div>
        <h1 className="text-h1 font-bold text-gray-700">Overview</h1>
        <p className="mt-1 text-body text-gray-500">
          Today and this month are in your timezone ({timeZone}).
        </p>
      </div>

      {drift === null && (
        <Alert variant="warning" title="Wallet check didn't run">
          The ledger comparison failed to load. Try again, or run reconcile-wallets from{" "}
          <Link href="/admin/settings" className="underline">
            Settings
          </Link>
          .
        </Alert>
      )}
      {drift && drift.mismatches > 0 && (
        <Alert variant="danger" title="Wallet drift found">
          {drift.mismatches} wallet{drift.mismatches === 1 ? "" : "s"} don&apos;t match the
          ledger. Don&apos;t correct balances by hand: trace which write bypassed the ledger.
        </Alert>
      )}

      <section aria-labelledby="needs-action" className="space-y-3">
        <h2 id="needs-action" className="text-h3 font-bold text-gray-700">
          Needs action
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Link href="/admin/withdrawals" className="focus-ring rounded-lg">
            <StatCard
              label="Open withdrawals"
              value={openWithdrawals}
              icon={<Banknote className="size-5" />}
              hint={`${overview.withdrawalsRequested} to approve, ${overview.withdrawalsApproved} to pay`}
            />
          </Link>
          <Link href="/admin/tutors" className="focus-ring rounded-lg">
            <StatCard
              label="Tutor applications"
              value={overview.pendingTutorApprovals}
              icon={<GraduationCap className="size-5" />}
              hint={`${overview.tutorsNeedingReReview} changed profile${overview.tutorsNeedingReReview === 1 ? "" : "s"} to re-review`}
            />
          </Link>
          <StatCard
            label="Wallet drift"
            value={drift ? drift.mismatches : "?"}
            icon={<Scale className="size-5" />}
            hint={drift ? `${drift.walletsChecked} wallets checked just now` : "Check failed"}
          />
        </div>
      </section>

      <section aria-labelledby="activity" className="space-y-3">
        <h2 id="activity" className="text-h3 font-bold text-gray-700">
          Activity
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label="Sessions today"
            value={overview.sessionsToday}
            icon={<CalendarDays className="size-5" />}
            hint="Scheduled or instant, excluding unpaid and expired"
          />
          <Link href="/admin/payments" className="focus-ring rounded-lg">
            <StatCard
              label="Captured today"
              value={usd(overview.capturedTodayUsd)}
              icon={<CreditCard className="size-5" />}
              hint={`${overview.capturedTodayCount} payment${overview.capturedTodayCount === 1 ? "" : "s"}, refunds excluded`}
            />
          </Link>
          <StatCard
            label="Captured this month"
            value={usd(overview.capturedMonthUsd)}
            icon={<CreditCard className="size-5" />}
            hint="PayPal captures, refunds excluded"
          />
        </div>
      </section>

      <section aria-labelledby="people" className="space-y-3">
        <h2 id="people" className="text-h3 font-bold text-gray-700">
          People
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Students" value={overview.students} icon={<Users className="size-5" />} />
          <StatCard label="Tutors" value={overview.tutors} icon={<GraduationCap className="size-5" />} />
          <StatCard label="Admins" value={overview.admins} />
          <StatCard
            label="Suspended"
            value={overview.suspended}
            hint={`${overview.noRole} signed up without a role`}
          />
        </div>
      </section>
    </div>
  );
}
