import * as React from "react";
import { cn } from "@/lib/utils";

export interface PriceTagProps extends React.HTMLAttributes<HTMLSpanElement> {
  credits: number;
  unit?: string; // e.g. "hr", "min", "session"
  usd?: number; // optional secondary USD label
  size?: "sm" | "md" | "lg";
}

const sizeMap = {
  sm: { amount: "text-body font-bold", unit: "text-caption" },
  md: { amount: "text-h3 font-bold", unit: "text-small" },
  lg: { amount: "text-h2 font-bold", unit: "text-small" },
} as const;

/** Displays a credit price, with an optional per-unit and USD equivalent. */
export function PriceTag({
  credits,
  unit,
  usd,
  size = "md",
  className,
  ...props
}: PriceTagProps) {
  const s = sizeMap[size];
  return (
    <span className={cn("inline-flex items-baseline gap-1", className)} {...props}>
      <span className={cn("text-gray-700", s.amount)}>
        {credits.toLocaleString()}
      </span>
      <span className={cn("text-gray-500", s.unit)}>
        {credits === 1 ? "credit" : "credits"}
        {unit ? ` / ${unit}` : ""}
      </span>
      {usd != null && (
        <span className={cn("text-gray-500", s.unit)}>
          (${usd.toFixed(2)})
        </span>
      )}
    </span>
  );
}
