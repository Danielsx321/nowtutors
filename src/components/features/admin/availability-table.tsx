import * as React from "react";
import Link from "next/link";
import { DataTable, StatusDot } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { formatHours, formatWeekRange } from "@/lib/availability-bonus/week";
import type { AdminAwardRow, AdminTutorProgress } from "@/db/queries/availability-bonus";

/**
 * The two tables on `/admin/availability` (SPEC §6; availability-bonus,
 * 2026-10-14): who is on track this week, and what has been paid.
 */

export function WeekProgressTable({
  rows,
  minSeconds,
}: {
  rows: AdminTutorProgress[];
  minSeconds: number;
}) {
  return (
    <DataTable
      caption="Live hours this week by tutor"
      rows={rows}
      rowKey={(r) => r.tutorId}
      minWidth={560}
      empty={
        <EmptyState
          title="No live time yet this week"
          description="Hours appear here as approved tutors go live. The week runs Monday to Sunday, UTC."
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
        { key: "live", header: "Live this week", align: "right", cell: (r) => formatHours(r.liveSeconds) },
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

export function AwardsTable({ rows, timeZone }: { rows: AdminAwardRow[]; timeZone: string }) {
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone });
  return (
    <DataTable
      caption="Weekly bonuses paid"
      rows={rows}
      rowKey={(r) => r.id}
      minWidth={640}
      empty={
        <EmptyState
          title="Nothing paid yet"
          description="The first bonuses go out the Monday after a week in which a tutor reaches the target."
        />
      }
      columns={[
        { key: "week", header: "Week", className: "whitespace-nowrap", cell: (r) => formatWeekRange(r.weekStart) },
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
        { key: "paid", header: "Paid", className: "whitespace-nowrap", cell: (r) => fmt.format(r.createdAt) },
      ]}
    />
  );
}
