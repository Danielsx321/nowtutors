import * as React from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRating } from "@/lib/reviews/review";

/**
 * The compact rating on a tutor card ("★ 4.8 (12)"), only when the tutor has
 * at least one published review; the card renders nothing otherwise, so a new
 * tutor never shows a zero (reviews v1, 2026-11-22).
 */
export function CardRating({
  avg,
  count,
  className,
}: {
  avg: number;
  count: number;
  className?: string;
}) {
  if (count < 1) return null;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1 text-caption font-medium", className)}
      aria-label={`Rated ${formatRating(avg)} out of 5 from ${count} ${count === 1 ? "review" : "reviews"}`}
    >
      <Star aria-hidden className="size-3.5 fill-current" />
      <span data-numeric aria-hidden>
        {formatRating(avg)} ({count})
      </span>
    </span>
  );
}
