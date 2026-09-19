import { DataTable, StatusDot, toneForVariant } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import type { EarningsBreakdown as Breakdown } from "@/db/queries/withdrawals";

const STATUS = {
  held: { label: "Held", variant: "warning" },
  available: { label: "Available", variant: "success" },
  withdrawn: { label: "Withdrawn", variant: "neutral" },
  // Phase 8 Part 6: an admin cancelled the session, so these earnings aren't paid.
  reversed: { label: "Reversed", variant: "danger" },
} as const;

/**
 * Held / available / withdrawn (SPEC §6 `/tutor/earnings`, §7.11). Net credits
 * throughout: the platform fee was taken when the session completed.
 */
export function EarningsBreakdown({
  breakdown,
  timeZone,
}: {
  breakdown: Breakdown;
  timeZone: string;
}) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
  const { totals, rows } = breakdown;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Held"
          value={totals.held.toLocaleString()}
          hint="Released 48 hours after the session"
        />
        <StatCard
          label="Released"
          value={totals.available.toLocaleString()}
          hint="Added to your wallet"
        />
        <StatCard
          label="Withdrawn"
          value={totals.withdrawn.toLocaleString()}
          hint="Paid out to PayPal"
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No earnings yet"
          description="Earnings appear here after each completed session."
        />
      ) : (
        <DataTable
          caption="Earnings history"
          rows={rows}
          rowKey={(r) => r.id}
          minWidth={680}
          columns={[
            { key: "ended", header: "Session ended", className: "whitespace-nowrap", cell: (r) => fmt.format(r.createdAt) },
            { key: "price", header: "Session price", align: "right", cell: (r) => r.grossCredits.toLocaleString() },
            {
              key: "earn",
              header: "You earn",
              align: "right",
              cell: (r) => <span className="font-medium">{r.netCredits.toLocaleString()}</span>,
            },
            {
              key: "status",
              header: "Status",
              cell: (r) => <StatusDot tone={toneForVariant(STATUS[r.status].variant)}>{STATUS[r.status].label}</StatusDot>,
            },
            {
              key: "available",
              header: "Available from",
              className: "whitespace-nowrap",
              cell: (r) => (r.availableAt ? fmt.format(r.availableAt) : "Not set"),
            },
          ]}
        />
      )}
    </div>
  );
}
