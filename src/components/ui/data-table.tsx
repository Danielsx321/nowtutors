import * as React from "react";
import { cn } from "@/lib/utils";

export interface DataColumn<T> {
  key: string;
  header: string;
  /** Numbers right-aligned with tabular figures; text left. */
  align?: "left" | "right";
  /** Visually hidden header (an actions column still needs a name). */
  srOnlyHeader?: boolean;
  cell: (row: T) => React.ReactNode;
  className?: string;
}

/**
 * The shared admin table (live-globe rebuild Part G, from the old Part 6
 * plan; pages.html `.tablewrap`): a white 22px card that scrolls sideways
 * instead of squashing columns, a small-caps header row, dashed row
 * separators, text left and numbers right with tabular figures, and a slot
 * for filter chips above it. Status cells use `StatusDot` (a dot with the
 * word, never colour alone).
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  empty,
  toolbar,
  minWidth = 720,
}: {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Read by screen readers; not shown. */
  caption?: string;
  empty?: React.ReactNode;
  /** Filter chips or similar, shown above the table. */
  toolbar?: React.ReactNode;
  minWidth?: number;
}) {
  return (
    <div className="grid gap-3">
      {toolbar}
      {rows.length === 0 && empty ? (
        empty
      ) : (
        <div className="overflow-x-auto rounded-card border border-border bg-surface-raised">
          <table className="w-full border-collapse text-[14.5px]" style={{ minWidth }}>
            {caption && <caption className="sr-only">{caption}</caption>}
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className={cn(
                      "border-b border-border px-[18px] py-3.5 text-caption font-medium uppercase tracking-[0.08em] text-text-muted",
                      c.align === "right" ? "text-right" : "text-left",
                    )}
                  >
                    {c.srOnlyHeader ? <span className="sr-only">{c.header}</span> : c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={rowKey(row)}>
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        "px-[18px] py-3.5 align-middle text-text",
                        i < rows.length - 1 && "border-b border-dashed border-border",
                        c.align === "right" && "text-right tabular-nums",
                        c.className,
                      )}
                    >
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const DOT: Record<string, string> = {
  live: "bg-live",
  primary: "bg-primary",
  spark: "bg-spark",
  danger: "bg-danger",
  muted: "bg-border-strong",
};

/** A status as a dot and a word (DESIGN.md: never colour alone). */
export function StatusDot({ tone, children }: { tone: keyof typeof DOT; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-medium text-text">
      <i aria-hidden className={cn("size-2 rounded-full", DOT[tone])} />
      {children}
    </span>
  );
}

/**
 * The `Badge` variant a status helper already returns (e.g. `bookingStatusMeta`)
 * mapped to a `StatusDot` tone, so a page moving from badges to the table keeps
 * one source of truth for which statuses are good, pending or bad.
 */
export function toneForVariant(variant: string): keyof typeof DOT {
  switch (variant) {
    case "success":
      return "live";
    case "accent":
      return "primary";
    case "warning":
      return "spark";
    case "danger":
      return "danger";
    default:
      return "muted";
  }
}
