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
  /** `ink` for dark surfaces (e.g. the ink TutorCard); `light` on white. */
  surface?: "light" | "ink";
}

/** Read-only 5-star rating with fractional fill (gold). */
export function RatingStars({
  value,
  count,
  size = "md",
  showValue = true,
  surface = "light",
  className,
  ...props
}: RatingStarsProps) {
  // Filled stars are gold on both surfaces (7.22:1 on ink). Only the empty
  // track and the value label change: empty stars use ink-700 on ink.
  const emptyColor = surface === "ink" ? "text-ink-700" : "text-gray-200";
  const valueColor = surface === "ink" ? "text-white" : "text-gray-700";
  const countColor = surface === "ink" ? "text-ink-300" : "text-gray-500";
  const clamped = Math.max(0, Math.min(5, value));
  const label =
    count != null
      ? `Rated ${clamped.toFixed(1)} out of 5 from ${count} reviews`
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
          className="absolute inset-0 flex overflow-hidden text-gold-400"
          style={{ width: `${(clamped / 5) * 100}%` }}
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <Star key={i} className={cn(sizes[size], "shrink-0 fill-current")} />
          ))}
        </div>
      </div>
      {showValue && (
        <span className={cn("text-small font-medium", valueColor)} aria-hidden>
          {clamped.toFixed(1)}
          {count != null && (
            <span className={countColor}> ({count})</span>
          )}
        </span>
      )}
    </div>
  );
}
