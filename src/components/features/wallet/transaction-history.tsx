import { DataTable } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";
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
    <DataTable
      caption="Credit history"
      rows={transactions}
      rowKey={(t) => t.id}
      minWidth={640}
      columns={[
        {
          key: "date",
          header: "Date",
          className: "whitespace-nowrap text-text-muted",
          cell: (t) => dateFormat.format(t.createdAt),
        },
        { key: "desc", header: "Description", cell: (t) => t.description ?? "None" },
        { key: "type", header: "Type", className: "text-text-muted", cell: (t) => creditTransactionLabel(t.type) },
        {
          key: "change",
          header: "Change",
          align: "right",
          className: "whitespace-nowrap",
          cell: (t) => (
            <span className={cn("font-medium", t.delta > 0 ? "text-success" : "text-text")}>
              {formatCreditDelta(t.delta)}
            </span>
          ),
        },
        {
          key: "balance",
          header: "Balance",
          align: "right",
          className: "whitespace-nowrap text-text-muted",
          cell: (t) => t.balanceAfter.toLocaleString(),
        },
      ]}
    />
  );
}
