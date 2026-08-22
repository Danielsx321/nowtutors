import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import {
  creditTransactionLabel,
  formatCreditDelta,
} from "@/lib/credits/transaction-labels";
import type { WalletTransaction } from "@/db/queries/wallet";

/**
 * Wallet transaction history (SPEC §7.10, §4.4). Renders the signed delta, the
 * resulting `balance_after`, the description, and the type — the ledger row as
 * recorded, since the ledger is the audit trail and is never rewritten.
 */
export function TransactionHistory({
  transactions,
  timeZone,
}: {
  transactions: WalletTransaction[];
  timeZone: string;
}) {
  if (transactions.length === 0) {
    return (
      <EmptyState
        title="No transactions yet"
        description="Buying credits or booking a session will show up here."
      />
    );
  }

  const dateFormat = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Description</TableHead>
          <TableHead>Type</TableHead>
          <TableHead className="text-right">Change</TableHead>
          <TableHead className="text-right">Balance</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {transactions.map((t) => (
          <TableRow key={t.id}>
            <TableCell className="whitespace-nowrap text-gray-500">
              {dateFormat.format(t.createdAt)}
            </TableCell>
            <TableCell>{t.description ?? "—"}</TableCell>
            <TableCell className="text-gray-500">
              {creditTransactionLabel(t.type)}
            </TableCell>
            <TableCell
              className={cn(
                "whitespace-nowrap text-right font-medium tabular-nums",
                t.delta > 0 ? "text-success" : "text-gray-700",
              )}
            >
              {formatCreditDelta(t.delta)}
            </TableCell>
            <TableCell className="whitespace-nowrap text-right tabular-nums text-gray-500">
              {t.balanceAfter.toLocaleString()}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
