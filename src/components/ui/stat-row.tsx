import * as React from "react";
import { cn } from "@/lib/utils";

export interface Stat {
  label: string;
  value: React.ReactNode;
}

export interface StatRowProps extends React.HTMLAttributes<HTMLDListElement> {
  /** Usually three: Experience, Sessions, Rate. */
  stats: Stat[];
  size?: "sm" | "md";
}

/**
 * Proof on the person (DESIGN.md, "Cards"): a row of labelled numbers with
 * hairline dividers, tabular figures. Used by the tutor card and profile. The
 * rating slot is deliberately absent until reviews exist (SPEC §18); it goes
 * first in the row when it lands.
 */
export function StatRow({ stats, size = "md", className, ...props }: StatRowProps) {
  return (
    <dl
      className={cn(
        "flex divide-x divide-border rounded-md border border-border bg-surface-muted/50",
        className,
      )}
      {...props}
    >
      {stats.map((s) => (
        <div
          key={s.label}
          className={cn("flex min-w-0 flex-1 flex-col", size === "sm" ? "px-2.5 py-1.5" : "px-3 py-2")}
        >
          <dt className={cn("truncate text-text-muted", size === "sm" ? "text-caption" : "text-small")}>
            {s.label}
          </dt>
          <dd
            data-numeric
            className={cn(
              "font-display font-semibold text-text",
              size === "sm" ? "text-small" : "text-body",
            )}
          >
            {s.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
