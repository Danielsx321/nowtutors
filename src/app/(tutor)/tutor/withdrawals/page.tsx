import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { getWithdrawalSettings } from "@/lib/settings";
import { getWalletBalanceFor } from "@/db/queries/wallet";
import {
  getPayoutEmailFor,
  hasOpenWithdrawal,
  listTutorWithdrawals,
} from "@/db/queries/withdrawals";
import {
  centsToUsdString,
  creditsToPayoutCents,
  usdToCents,
} from "@/lib/withdrawals/payout-rate";
import { withdrawalRefusalMessage } from "@/lib/withdrawals/withdrawals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreditBalance } from "@/components/ui/credit-balance";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WithdrawalRequest } from "@/components/features/tutor/withdrawal-request";
import { WithdrawalStatusBadge } from "@/components/features/withdrawals/status-badge";

export const metadata = { title: "Withdrawals · NowTutors" };
export const dynamic = "force-dynamic";

/**
 * `/tutor/withdrawals`: available balance, the minimum, the PayPal email with an
 * edit link, the request control, and history (SPEC §6, §7.11; Phase 8 Part 2).
 *
 * `requireRole('tutor')` first, approval enforced (§5 Layer 2). Everything shown
 * as "why you can't withdraw" is a courtesy; `requestWithdrawal` re-derives it
 * under the wallet lock and is the only authority.
 */
export default async function TutorWithdrawalsPage() {
  const { user } = await requireRole("tutor");

  const [balance, settings, email, open, history, [me]] = await Promise.all([
    getWalletBalanceFor(user.id),
    getWithdrawalSettings(),
    getPayoutEmailFor(user.id),
    hasOpenWithdrawal(user.id),
    listTutorWithdrawals(user.id),
    db
      .select({ timezone: profiles.timezone })
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .limit(1),
  ]);

  const rate = settings.payoutUsdPerCredit;
  const cents = rate !== null ? creditsToPayoutCents(balance, rate) : null;
  const availableUsd = cents !== null ? centsToUsdString(cents) : null;

  const blocked =
    rate === null
      ? "payout_rate_unset"
      : open
        ? "already_open"
        : !email
          ? "no_payout_email"
          : balance <= 0
            ? "no_balance"
            : cents! < usdToCents(settings.minWithdrawalUsd)
              ? "below_minimum"
              : null;

  const fmt = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: me?.timezone ?? "UTC",
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-h1 font-bold text-gray-700">Withdrawals</h1>
          <p className="mt-1 text-body text-gray-500">
            Minimum withdrawal ${settings.minWithdrawalUsd.toFixed(2)}.
          </p>
        </div>
        <div className="text-right">
          <CreditBalance credits={balance} size="lg" />
          {availableUsd && (
            <p className="mt-1 text-small text-gray-500">about ${availableUsd}</p>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Request a withdrawal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-body text-gray-700">
            Paid to{" "}
            {email ? (
              <span className="font-medium">{email}</span>
            ) : (
              <span className="text-gray-500">no PayPal email yet</span>
            )}{" "}
            ·{" "}
            <Link
              href="/tutor/settings"
              className="focus-ring rounded-sm text-purple-500 hover:underline"
            >
              {email ? "Edit" : "Add one"}
            </Link>
          </p>
          <WithdrawalRequest
            availableCredits={balance}
            availableUsd={availableUsd}
            blockedReason={
              blocked ? withdrawalRefusalMessage(blocked, settings) : null
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <EmptyState title="No withdrawals yet" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Requested</TableHead>
                  <TableHead className="text-right">Credits</TableHead>
                  <TableHead className="text-right">USD</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell>{fmt.format(w.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      {w.amountCredits.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">${w.amountUsd}</TableCell>
                    <TableCell>
                      <WithdrawalStatusBadge status={w.status} />
                    </TableCell>
                    <TableCell className="text-small text-gray-500">
                      {w.adminNote ?? ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
