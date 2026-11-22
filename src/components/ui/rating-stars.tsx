import * as React from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

const sizes = { sm: "size-3.5", md: "size-4", lg: "size-5" } as const;

export interface RatingStarsProps
  extends React.HTMLAttributes<HTMLDivElement> {
  value: number; // 0–5, fractional allowed
  count?: number;
  size?: keyof typeof sizes;
  showValue?: boolean;
}

/**
 * Read-only 5-star rating with fractional fill. Rendered since reviews v1
 * (2026-11-22): profile Reviews block, review form, /admin/reviews. Filled stars are ink, not
 * green: green is the live signal and nothing else (DESIGN.md).
 */
export function RatingStars({
  value,
  count,
  size = "md",
  showValue = true,
  className,
  ...props
}: RatingStarsProps) {
  const emptyColor = "text-border";
  const fillColor = "text-text";
  const valueColor = "text-text";
  const countColor = "text-text-muted";
  const clamped = Math.max(0, Math.min(5, value));
  const label =
    count != null
      ? `Rated ${clamped.toFixed(1)} out of 5 from ${count} ${count === 1 ? "review" : "reviews"}`
      : `Rated ${clamped.toFixed(1)} out of 5`;
  return (
    <div
      className={cn("inline-flex items-center gap-1.5", className)}
      role="img"
      aria-label={label}
      {...props}
    >
      <div className="relative inline-flex" aria-hidden>
        <div className={cn("flex", emptyColor)}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Star key={i} className={cn(sizes[size], "fill-current")} />
          ))}
        </div>
        <div
          className={cn("absolute inset-0 flex overflow-hidden", fillColor)}
          style={{ width: `${(clamped / 5) * 100}%` }}
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <Star key={i} className={cn(sizes[size], "shrink-0 fill-current")} />
          ))}
        </div>
      </div>
      {showValue && (
        <span data-numeric className={cn("text-small font-medium", valueColor)} aria-hidden>
          {clamped.toFixed(1)}
          {count != null && (
            <span className={countColor}> ({count})</span>
          )}
        </span>
      )}
    </div>
  );
}
