import * as React from "react";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { ArrowUpRight, CalendarDays, CreditCard, GraduationCap, Users } from "lucide-react";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { getAdminOverview, safeTimeZone } from "@/db/queries/admin-overview";
import { getChangedTutors, getPendingTutors, type AdminTutorRow } from "@/db/queries/admin-tutors";
import { listAdminWithdrawals, type AdminWithdrawal } from "@/db/queries/withdrawals";
import { listAuditLog } from "@/db/queries/admin-audit";
import { getLiveTutorCount } from "@/db/queries/tutors";
import { getCapturedRevenueByMonth } from "@/db/queries/dashboard-stats";
import { readWalletDrift } from "@/db/queries/reconcile-wallets";
import { summarizeWalletDrift, type ReconcileSummary } from "@/lib/wallets/reconcile";
import { approvalBlocker, approvalBlockerMessage } from "@/lib/tutors/approval";
import { maskEmail } from "@/lib/withdrawals/mask-email";
import { auditActionLabel } from "@/lib/admin/audit-labels";
import { fullWhen, timeAgo } from "@/lib/dashboard/when";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DataTable, StatusDot } from "@/components/ui/data-table";
import { TutorPhoto } from "@/components/features/tutor-photo";
import { Banner } from "@/components/features/dashboard/banner";
import { SummaryCard } from "@/components/features/dashboard/summary-card";
import { BarChart } from "@/components/features/dashboard/bar-chart";
import { DashboardColumns, RailBox } from "@/components/features/dashboard/dashboard-columns";

export const metadata = { title: "Admin · NowTutors" };
export const dynamic = "force-dynamic";

const usd = (amount: string | number) =>
  Number(amount).toLocaleString("en-US", { style: "currency", currency: "USD" });

type QueueItem = { kind: "new" | "changed"; tutor: AdminTutorRow };

/**
 * `/admin`, the admin's home (live-globe rebuild Part G, as approved in Part
 * 0; pages.html, Admin dashboard). Counts and queues only, all real (§14 still
 * rules out an analytics suite):
 *
 * - a teal banner with what is waiting (tutor applications, re-reviews,
 *   withdrawals to approve or pay) and one way into the queue;
 * - the wallet check, run live on page load, reporting drift and never
 *   repairing it (unchanged from Phase 8);
 * - four summary cards: students, tutors (and how many are live), sessions
 *   today, captured today;
 * - the approval queue as photo cards, with the photo rule shown up front;
 * - the right column: captured revenue this month and per month, the accounts
 *   breakdown, and recent audit activity in plain words;
 * - withdrawals to pay across the full width, with the PayPal address masked.
 *
 * Actions stay on their own pages (approve and reject on /admin/tutors,
 * approve and mark paid on /admin/withdrawals), where the confirmations and
 * the transaction-id field live; this page links to them.
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

  const [overview, drift, pending, changed, requested, approved, audit, liveCount, revenue] = await Promise.all([
    getAdminOverview(timeZone),
    readWalletDrift()
      .then(({ walletsChecked, rows }) => summarizeWalletDrift(walletsChecked, rows))
      .catch((err: unknown): ReconcileSummary | null => {
        console.error("[admin/overview] wallet check failed", err);
        return null;
      }),
    getPendingTutors(),
    getChangedTutors(),
    listAdminWithdrawals("requested"),
    listAdminWithdrawals("approved"),
    listAuditLog({ page: 1 }),
    getLiveTutorCount().catch(() => 0),
    getCapturedRevenueByMonth(timeZone, 5),
  ]);

  const now = new Date();
  const waiting =
    overview.pendingTutorApprovals +
    overview.tutorsNeedingReReview +
    overview.withdrawalsRequested +
    overview.withdrawalsApproved;
  const waitingParts = [
    overview.pendingTutorApprovals > 0 &&
      `${overview.pendingTutorApprovals} ${overview.pendingTutorApprovals === 1 ? "tutor" : "tutors"} to approve`,
    overview.tutorsNeedingReReview > 0 &&
      `${overview.tutorsNeedingReReview} ${overview.tutorsNeedingReReview === 1 ? "profile" : "profiles"} to re-review`,
    overview.withdrawalsRequested > 0 &&
      `${overview.withdrawalsRequested} ${overview.withdrawalsRequested === 1 ? "withdrawal" : "withdrawals"} to approve`,
    overview.withdrawalsApproved > 0 &&
      `${overview.withdrawalsApproved} ${overview.withdrawalsApproved === 1 ? "withdrawal" : "withdrawals"} to pay`,
  ].filter(Boolean) as string[];
  const queueHref =
    overview.pendingTutorApprovals + overview.tutorsNeedingReReview > 0 ? "/admin/tutors" : "/admin/withdrawals";

  const queue: QueueItem[] = [
    ...pending.map((tutor) => ({ kind: "new" as const, tutor })),
    ...changed.map((tutor) => ({ kind: "changed" as const, tutor })),
  ].slice(0, 4);

  const toPay: AdminWithdrawal[] = [...requested, ...approved].slice(0, 6);
  const thisMonth = revenue[revenue.length - 1];

  const main = (
    <>
      <Banner
        kicker="Needs you today"
        title={
          waiting > 0
            ? `${waiting} ${waiting === 1 ? "thing is" : "things are"} waiting in your queues`
            : "Nothing is waiting in your queues"
        }
      >
        {waiting > 0 ? (
          <Button asChild variant="highlight">
            <Link href={queueHref}>Open the queue</Link>
          </Button>
        ) : null}
        <span className="text-small text-on-primary/75">
          {waitingParts.length > 0 ? waitingParts.join(" · ") : "Applications and withdrawals will show up here."}
        </span>
      </Banner>

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
          {drift.mismatches} wallet{drift.mismatches === 1 ? "" : "s"} don&apos;t match the ledger. Don&apos;t
          correct balances by hand: trace which write bypassed the ledger.
        </Alert>
      )}

      <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr))]">
        <SummaryCard icon={Users} label="Students" value={overview.students.toLocaleString()} href="/admin/users" />
        <SummaryCard
          icon={GraduationCap}
          label="Tutors"
          value={`${overview.tutors.toLocaleString()} · ${liveCount.toLocaleString()} live`}
          href="/admin/tutors"
        />
        <SummaryCard
          icon={CalendarDays}
          label="Sessions today"
          value={overview.sessionsToday.toLocaleString()}
          href="/admin/bookings"
        />
        <SummaryCard
          icon={CreditCard}
          label="Captured today"
          value={`${usd(overview.capturedTodayUsd)} · ${overview.capturedTodayCount} ${overview.capturedTodayCount === 1 ? "payment" : "payments"}`}
          href="/admin/payments"
        />
      </div>

      <section aria-labelledby="queue-title" className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="queue-title" className="font-display text-[22px] font-semibold tracking-[-0.02em] text-text">
            Approval queue
          </h2>
          <Link href="/admin/tutors" className="focus-ring rounded-sm font-medium text-accent hover:underline">
            All tutors
          </Link>
        </div>
        {queue.length === 0 ? (
          <p className="rounded-card border border-border bg-surface-raised p-6 text-body text-text-muted">
            No applications or changed profiles to review.
          </p>
        ) : (
          <ul className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,230px),1fr))]">
            {queue.map((item) => (
              <QueueCard key={`${item.kind}-${item.tutor.userId}`} item={item} now={now} timeZone={timeZone} />
            ))}
          </ul>
        )}
      </section>
    </>
  );

  const rail = (
    <>
      <RailBox title="Revenue" action={<span className="text-caption text-text-muted">captured, USD</span>}>
        <div>
          <p className="text-small text-text-muted">This month</p>
          <p data-numeric className="font-display text-[36px] font-medium leading-none tracking-[-0.03em] text-text">
            {usd(overview.capturedMonthUsd)}
          </p>
          {thisMonth && (
            <p className="mt-1 text-caption text-text-muted">
              {thisMonth.count} {thisMonth.count === 1 ? "payment" : "payments"}, refunds excluded
            </p>
          )}
        </div>
        <div className="rounded-[18px] border border-border p-4">
          <p className="mb-2 text-small font-medium text-text">Captured revenue per month</p>
          <BarChart
            data={revenue.map((m) => ({ label: m.label, value: Math.round(m.value) }))}
            unit="USD"
            title="Captured revenue per month"
          />
        </div>
      </RailBox>

      <RailBox title="Accounts">
        <dl className="grid">
          {[
            ["Students", overview.students],
            ["Tutors", overview.tutors],
            ["Admins", overview.admins],
            ["Signed up, no role yet", overview.noRole],
            ["Suspended", overview.suspended],
          ].map(([label, value], i, all) => (
            <div
              key={label as string}
              className={
                "flex justify-between py-2.5 text-[14.5px]" +
                (i < all.length - 1 ? " border-b border-dashed border-border" : "")
              }
            >
              <dt className="text-text">{label}</dt>
              <dd data-numeric className="font-display font-semibold text-text">
                {(value as number).toLocaleString()}
              </dd>
            </div>
          ))}
        </dl>
      </RailBox>

      <RailBox
        title="Recent activity"
        action={
          <Link href="/admin/audit" className="focus-ring rounded-sm text-small font-medium text-accent hover:underline">
            Audit log
          </Link>
        }
      >
        {audit.entries.length === 0 ? (
          <p className="text-small text-text-muted">Admin actions will be listed here.</p>
        ) : (
          <ul className="grid gap-3">
            {audit.entries.slice(0, 5).map((e) => (
              <li key={e.id} className="grid gap-0.5 border-l border-border pl-3.5 text-small text-text">
                {auditActionLabel(e.action)}
                <span className="text-caption text-text-muted">
                  {(e.actorName ?? e.actorEmail ?? "System").split(/\s+/)[0]} · {timeAgo(e.createdAt, now, timeZone)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </RailBox>
    </>
  );

  const full = (
    <>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-text">Withdrawals to pay</h2>
        <Link href="/admin/withdrawals" className="focus-ring rounded-sm font-medium text-accent hover:underline">
          All withdrawals
        </Link>
      </div>
      <DataTable
        caption="Withdrawals waiting for approval or payment"
        rows={toPay}
        rowKey={(w) => w.id}
        empty={
          <p className="rounded-card border border-border bg-surface-raised p-6 text-body text-text-muted">
            No withdrawals waiting.
          </p>
        }
        columns={[
          {
            key: "tutor",
            header: "Tutor",
            cell: (w) => (
              <span className="flex items-center gap-2.5">
                <Avatar name={w.tutorName ?? w.tutorEmail} size="sm" />
                {w.tutorName ?? w.tutorEmail}
              </span>
            ),
          },
          {
            key: "amount",
            header: "Amount",
            align: "right",
            cell: (w) => `${w.amountCredits.toLocaleString()} cr · $${w.amountUsd}`,
          },
          { key: "paypal", header: "PayPal", cell: (w) => maskEmail(w.payoutDestination) },
          { key: "requested", header: "Requested", cell: (w) => fullWhen(w.createdAt, now, timeZone) },
          {
            key: "status",
            header: "Status",
            cell: (w) =>
              w.status === "requested" ? (
                <StatusDot tone="spark">To approve</StatusDot>
              ) : (
                <StatusDot tone="primary">Approved, to pay</StatusDot>
              ),
          },
          {
            key: "open",
            header: "Open",
            srOnlyHeader: true,
            align: "right",
            cell: (w) => (
              <Link
                href={`/admin/withdrawals?status=${w.status}`}
                aria-label={`Open ${w.status === "requested" ? "withdrawals to approve" : "withdrawals to pay"}`}
                className="focus-ring inline-grid size-[34px] place-items-center rounded-full border border-border text-accent hover:bg-surface-muted"
              >
                <ArrowUpRight className="size-4" aria-hidden />
              </Link>
            ),
          },
        ]}
      />
    </>
  );

  return <DashboardColumns main={main} rail={rail} full={full} />;
}

/** One approval-queue card (pages.html `.qcard`), with the photo rule shown before anyone clicks. */
function QueueCard({ item, now, timeZone }: { item: QueueItem; now: Date; timeZone: string }) {
  const { tutor, kind } = item;
  const name = tutor.displayName ?? tutor.email;
  const blocker = kind === "new" ? approvalBlocker(tutor) : null;
  const subjects = tutor.subjects.map((s) => s.name).slice(0, 2).join(", ");
  const when =
    kind === "new"
      ? `submitted ${timeAgo(tutor.createdAt, now, timeZone)}`
      : `changed ${tutor.profileChangedAt ? timeAgo(tutor.profileChangedAt, now, timeZone) : "recently"} · re-review`;

  return (
    <li className="flex flex-col gap-2.5 rounded-[20px] border border-border bg-surface-raised p-2.5">
      <div className="relative">
        {tutor.avatarUrl ? (
          <TutorPhoto src={tutor.avatarUrl} name={name} sizes="260px" className="aspect-[4/3] w-full rounded-[14px]" initialsClassName="text-display" />
        ) : (
          <div className="grid aspect-[4/3] w-full place-items-center rounded-[14px] bg-surface-muted p-2.5 text-center text-small font-medium text-text-muted">
            No photo yet
          </div>
        )}
        <span className="absolute left-2.5 top-2.5 rounded-full bg-surface-raised px-2.5 py-0.5 text-caption font-semibold text-text">
          {kind === "new" ? "New tutor" : "Profile changed"}
        </span>
      </div>
      <div className="grid gap-2 px-1 pb-1">
        <b className="font-display text-body font-semibold text-text">{name}</b>
        <span className="text-small text-text-muted">{[subjects, when].filter(Boolean).join(" · ")}</span>
        {blocker && <span className="text-caption font-medium text-spark-text">{approvalBlockerMessage(blocker)}</span>}
        <Button asChild size="sm" variant={kind === "new" && !blocker ? "primary" : "outline"}>
          <Link href="/admin/tutors">{kind === "new" ? "Review" : "Compare changes"}</Link>
        </Button>
      </div>
    </li>
  );
}
