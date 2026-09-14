import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { getWithdrawalSettings } from "@/lib/settings";
import {
  countWithdrawalsByStatus,
  listAdminWithdrawals,
} from "@/db/queries/withdrawals";
import type { WithdrawalStatus } from "@/lib/withdrawals/withdrawals";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { withdrawalStatusLabel } from "@/components/features/withdrawals/status-badge";
import {
  WithdrawalQueue,
  type QueueWithdrawal,
} from "@/components/features/admin/withdrawal-queue";

export const metadata = { title: "Withdrawals · NowTutors" };
export const dynamic = "force-dynamic";

const TABS: WithdrawalStatus[] = ["requested", "approved", "paid", "rejected"];

/**
 * `/admin/withdrawals`: the payout queue (SPEC §6, §7.11; Phase 8 Part 2).
 * Tabs are plain links (`?status=`) so a queue view is linkable.
 * `requireRole('admin')` first, independently of the layout (§5 Layer 2).
 */
export default async function AdminWithdrawalsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { user } = await requireRole("admin");
  const { status: param } = await searchParams;
  const status: WithdrawalStatus = TABS.includes(param as WithdrawalStatus)
    ? (param as WithdrawalStatus)
    : "requested";

  const [rows, counts, settings, [me]] = await Promise.all([
    listAdminWithdrawals(status),
    countWithdrawalsByStatus(),
    getWithdrawalSettings(),
    db
      .select({ timezone: profiles.timezone })
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .limit(1),
  ]);

  const fmt = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: me?.timezone ?? "UTC",
  });

  const withdrawals: QueueWithdrawal[] = rows.map((r) => ({
    id: r.id,
    tutorName: r.tutorName,
    tutorEmail: r.tutorEmail,
    amountCredits: r.amountCredits,
    amountUsd: r.amountUsd,
    payoutDestination: r.payoutDestination,
    status: r.status,
    adminNote: r.adminNote,
    externalReference: r.externalReference,
    requestedLabel: fmt.format(r.createdAt),
    processedLabel: r.processedAt ? fmt.format(r.processedAt) : null,
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-8">
      <div>
        <h1 className="text-h1 font-bold text-gray-700">Withdrawals</h1>
        <p className="mt-1 text-body text-gray-500">
          Approve, pay in PayPal, then mark paid with the transaction ID.
        </p>
      </div>

      {settings.payoutUsdPerCredit === null && (
        <Alert variant="warning" title="Payout rate not set">
          Tutors can&apos;t request withdrawals until{" "}
          <code>payout_usd_per_credit</code> is set in platform settings.
        </Alert>
      )}

      <nav aria-label="Withdrawal status" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/admin/withdrawals?status=${t}`}
            aria-current={t === status ? "page" : undefined}
            className={cn(
              "focus-ring rounded-full border px-3 py-1 text-small font-medium",
              t === status
                ? "border-purple-500 bg-purple-100 text-purple-700"
                : "border-gray-200 text-gray-700 hover:bg-gray-50",
            )}
          >
            {withdrawalStatusLabel(t)} ({counts[t]})
          </Link>
        ))}
      </nav>

      <WithdrawalQueue
        withdrawals={withdrawals}
        emptyLabel={`No ${withdrawalStatusLabel(status).toLowerCase()} withdrawals`}
      />
    </div>
  );
}
