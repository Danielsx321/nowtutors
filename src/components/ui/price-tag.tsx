import * as React from "react";
import { cn } from "@/lib/utils";

export interface PriceTagProps extends React.HTMLAttributes<HTMLSpanElement> {
  credits: number;
  unit?: string; // e.g. "hr", "min", "session"
  usd?: number; // optional secondary USD label
  size?: "sm" | "md" | "lg";
}

const sizeMap = {
  sm: { amount: "text-body font-semibold", unit: "text-caption" },
  md: { amount: "text-h3 font-semibold", unit: "text-small" },
  lg: { amount: "text-h2 font-semibold", unit: "text-small" },
} as const;

/**
 * Displays a credit price, with an optional per-unit and USD equivalent.
 * Prefer `Money` for new surfaces: it carries the "≈ $" anchor from the basis
 * package instead of a caller-supplied USD figure.
 */
export function PriceTag({
  credits,
  unit,
  usd,
  size = "md",
  className,
  ...props
}: PriceTagProps) {
  const s = sizeMap[size];
  const amountColor = "text-text";
  const unitColor = "text-text-muted";
  return (
    <span
      data-numeric
      className={cn("inline-flex items-baseline gap-1", className)}
      {...props}
    >
      <span className={cn(amountColor, "font-display", s.amount)}>
        {credits.toLocaleString()}
      </span>
      <span className={cn(unitColor, s.unit)}>
        {credits === 1 ? "credit" : "credits"}
        {unit ? ` / ${unit}` : ""}
      </span>
      {usd != null && (
        <span className={cn(unitColor, s.unit)}>
          (${usd.toFixed(2)})
        </span>
      )}
    </span>
  );
}
