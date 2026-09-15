import * as React from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

export interface StatCardProps
  extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  hint?: React.ReactNode;
  trend?: { direction: "up" | "down"; label: string };
  /** @deprecated kept rendering for the old dark dashboards. REMOVE IN PART 6. */
  surface?: "white" | "ink";
}

/** Dashboard metric tile: label, big value in tabular figures, optional icon/trend. */
export function StatCard({
  label,
  value,
  icon,
  hint,
  trend,
  surface = "white",
  className,
  ...props
}: StatCardProps) {
  const ink = surface === "ink";
  const muted = ink ? "text-text-on-inverse/70" : "text-text-muted";
  return (
    <Card surface={surface} className={cn("p-5", className)} {...props}>
      <div className="flex items-start justify-between gap-3">
        <p className={cn("text-small font-medium", muted)}>{label}</p>
        {icon && (
          <span
            className={cn(
              "grid size-9 place-items-center rounded-md",
              ink ? "bg-text-on-inverse/10 text-text-on-inverse" : "bg-surface-muted text-text-muted",
            )}
            aria-hidden
          >
            {icon}
          </span>
        )}
      </div>
      <p data-numeric className="mt-2 font-display text-h1 font-semibold">
        {value}
      </p>
      {(hint || trend) && (
        <div className="mt-1 flex items-center gap-2 text-small">
          {trend && (
            <span
              className={cn(
                "font-medium",
                trend.direction === "up" ? "text-success" : "text-danger",
              )}
            >
              {trend.direction === "up" ? "▲" : "▼"} {trend.label}
            </span>
          )}
          {hint && <span className={muted}>{hint}</span>}
        </div>
      )}
    </Card>
  );
}
