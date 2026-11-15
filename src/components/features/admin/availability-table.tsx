import * as React from "react";
import Link from "next/link";
import { DataTable, StatusDot } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { formatHours, formatMonth } from "@/lib/availability-bonus/month";
import type { AdminMonthlyAwardRow, AdminTutorProgress } from "@/db/queries/availability-bonus";

/**
 * The two tables on `/admin/availability` (SPEC §6; availability-bonus,
 * monthly since 2026-11-15): who is on track this month, and what has been paid.
 */

export function MonthProgressTable({
  rows,
  minSeconds,
}: {
  rows: AdminTutorProgress[];
  minSeconds: number;
}) {
  return (
    <DataTable
      caption="Live hours this month by tutor"
      rows={rows}
      rowKey={(r) => r.tutorId}
      minWidth={560}
      empty={
        <EmptyState
          title="No live time yet this month"
          description="Hours appear here as approved tutors go live. The month is a calendar month, UTC."
        />
      }
      columns={[
        {
          key: "tutor",
          header: "Tutor",
          cell: (r) => (
            <Link href={`/admin/users/${r.tutorId}`} className="focus-ring font-medium text-accent">
              {r.fullName ?? r.slug}
            </Link>
          ),
        },
        { key: "live", header: "Live this month", align: "right", cell: (r) => formatHours(r.liveSeconds) },
        {
          key: "status",
          header: "Bonus",
          cell: (r) =>
            r.liveSeconds >= minSeconds ? (
              <StatusDot tone="live">Reached</StatusDot>
            ) : (
              <StatusDot tone="muted">{formatHours(minSeconds - r.liveSeconds)} to go</StatusDot>
            ),
        },
        {
          key: "now",
          header: "Now",
          cell: (r) => (r.isLive ? <StatusDot tone="live">Live</StatusDot> : <span className="text-text-muted">Offline</span>),
        },
      ]}
    />
  );
}

export function MonthlyAwardsTable({ rows, timeZone }: { rows: AdminMonthlyAwardRow[]; timeZone: string }) {
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone });
  return (
    <DataTable
      caption="Monthly bonuses paid"
      rows={rows}
      rowKey={(r) => r.id}
      minWidth={640}
      empty={
        <EmptyState
          title="Nothing paid yet"
          description="Bonuses go out on the 1st for the month before, to every tutor who reached the target."
        />
      }
      columns={[
        { key: "month", header: "Month", className: "whitespace-nowrap", cell: (r) => formatMonth(r.monthStart) },
        {
          key: "tutor",
          header: "Tutor",
          cell: (r) => (
            <Link href={`/admin/users/${r.tutorId}`} className="focus-ring font-medium text-accent">
              {r.fullName ?? r.slug}
            </Link>
          ),
        },
        { key: "live", header: "Live for", align: "right", cell: (r) => formatHours(r.liveSeconds) },
        { key: "credits", header: "Credits", align: "right", cell: (r) => r.credits.toLocaleString() },
        {
          key: "weekly",
          header: "Weekly already paid",
          align: "right",
          cell: (r) => (r.weeklyCreditsDeducted > 0 ? r.weeklyCreditsDeducted.toLocaleString() : "·"),
        },
        { key: "paid", header: "Paid", className: "whitespace-nowrap", cell: (r) => fmt.format(r.createdAt) },
      ]}
    />
  );
}
