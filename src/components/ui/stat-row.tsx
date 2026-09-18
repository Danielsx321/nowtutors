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
 * Proof on the person (DESIGN.md, "Cards"): a row of labelled numbers in equal
 * cells with hairline dividers, tabular figures (v2: a 14px bordered strip, no
 * tint, as in pages.html). Used by the tutor card and profile. The rating slot
 * is deliberately absent until reviews exist (SPEC §18); it goes first in the
 * row when it lands.
 */
export function StatRow({ stats, size = "md", className, ...props }: StatRowProps) {
  return (
    <dl
      className={cn(
        "grid auto-cols-fr grid-flow-col divide-x divide-border overflow-hidden rounded-lg border border-border",
        className,
      )}
      {...props}
    >
      {stats.map((s) => (
        <div
          key={s.label}
          className={cn("flex min-w-0 flex-col", size === "sm" ? "px-3 py-2.5" : "px-4 py-3")}
        >
          <dt className={cn("truncate text-text-muted", size === "sm" ? "text-caption" : "text-small")}>
            {s.label}
          </dt>
          <dd
            data-numeric
            className={cn(
              "font-display font-semibold text-text",
              size === "sm" ? "text-body" : "text-h3",
            )}
          >
            {s.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
