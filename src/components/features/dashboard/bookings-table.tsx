import * as React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { bookingStatusMeta } from "@/lib/bookings/status";
import { cn } from "@/lib/utils";

export interface BookingsTableRow {
  id: string;
  href: string;
  personName: string;
  personAvatarUrl: string | null;
  /** Under the name: "45 credits". */
  detail: string | null;
  subject: string | null;
  /** Already formatted in the viewer's timezone. */
  when: string;
  /** The booking status enum value; the label and dot come from `bookingStatusMeta`. */
  status: string;
}

const STATUS_DOT: Record<string, string> = {
  success: "bg-live",
  warning: "bg-warning",
  danger: "bg-danger",
  accent: "bg-accent",
  neutral: "bg-border-strong",
};

/**
 * A dashboard's bookings table (pages.html `.tablewrap`, full width under the
 * main area and right column): person with avatar and a detail line, subject
 * tag, when, a status dot with the word (never colour alone), and an open
 * arrow. Scrolls sideways on narrow screens rather than squashing columns.
 * The shared admin `DataTable` arrives in Part G; this is the read-only
 * dashboard summary.
 */
export function BookingsTable({ rows, personHeading }: { rows: BookingsTableRow[]; personHeading: string }) {
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface-raised">
      <table className="w-full min-w-[620px] border-collapse text-[14.5px]">
        <thead>
          <tr>
            {[personHeading, "Subject", "When", "Status"].map((h) => (
              <th
                key={h}
                scope="col"
                className="border-b border-border px-[18px] py-3.5 text-left text-caption font-medium uppercase tracking-[0.08em] text-text-muted"
              >
                {h}
              </th>
            ))}
            <th scope="col" className="border-b border-border px-[18px] py-3.5">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const meta = bookingStatusMeta(r.status);
            const cell = cn("px-[18px] py-3.5 align-middle", i < rows.length - 1 && "border-b border-dashed border-border");
            return (
              <tr key={r.id}>
                <td className={cell}>
                  <span className="flex items-center gap-2.5">
                    <Avatar src={r.personAvatarUrl ?? undefined} name={r.personName} size="sm" />
                    <span>
                      <span className="block text-text">{r.personName}</span>
                      {r.detail && (
                        <span data-numeric className="block text-caption text-text-muted">
                          {r.detail}
                        </span>
                      )}
                    </span>
                  </span>
                </td>
                <td className={cell}>
                  {r.subject ? (
                    <span className="rounded-full border border-border px-2.5 py-0.5 text-caption font-medium text-text">
                      {r.subject}
                    </span>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </td>
                <td className={cn(cell, "text-text")}>{r.when}</td>
                <td className={cell}>
                  <span className="inline-flex items-center gap-1.5 font-medium text-text">
                    <i aria-hidden className={cn("size-2 rounded-full", STATUS_DOT[meta.variant] ?? "bg-border-strong")} />
                    {meta.label}
                  </span>
                </td>
                <td className={cn(cell, "text-right")}>
                  <Link
                    href={r.href}
                    aria-label={`Open booking with ${r.personName}`}
                    className="focus-ring inline-grid size-[34px] place-items-center rounded-full border border-border text-accent hover:bg-surface-muted"
                  >
                    <ArrowUpRight className="size-4" aria-hidden />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
