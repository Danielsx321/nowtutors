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
  surface?: "white" | "ink";
}

/** Dashboard metric tile — label, big value, optional icon/trend. */
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
  return (
    <Card surface={surface} className={cn("p-5", className)} {...props}>
      <div className="flex items-start justify-between gap-3">
        <p
          className={cn(
            "text-small font-medium",
            surface === "ink" ? "text-gray-200" : "text-gray-500",
          )}
        >
          {label}
        </p>
        {icon && (
          <span
            className={cn(
              "grid size-9 place-items-center rounded-md",
              surface === "ink"
                ? "bg-ink-900 text-gold-400"
                : "bg-purple-100 text-purple-500",
            )}
            aria-hidden
          >
            {icon}
          </span>
        )}
      </div>
      <p className="mt-2 text-h1 font-bold">{value}</p>
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
          {hint && (
            <span className={surface === "ink" ? "text-gray-200" : "text-gray-500"}>
              {hint}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
