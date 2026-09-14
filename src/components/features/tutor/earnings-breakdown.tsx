import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { EarningsBreakdown as Breakdown } from "@/db/queries/withdrawals";

const STATUS = {
  held: { label: "Held", variant: "warning" },
  available: { label: "Available", variant: "success" },
  withdrawn: { label: "Withdrawn", variant: "neutral" },
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Session ended</TableHead>
              <TableHead className="text-right">Session price</TableHead>
              <TableHead className="text-right">You earn</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Available from</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{fmt.format(r.createdAt)}</TableCell>
                <TableCell className="text-right">
                  {r.grossCredits.toLocaleString()}
                </TableCell>
                <TableCell className="text-right font-medium">
                  {r.netCredits.toLocaleString()}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS[r.status].variant}>
                    {STATUS[r.status].label}
                  </Badge>
                </TableCell>
                <TableCell>
                  {r.availableAt ? fmt.format(r.availableAt) : "Not set"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
