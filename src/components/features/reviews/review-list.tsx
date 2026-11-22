import * as React from "react";
import { RatingStars } from "@/components/ui/rating-stars";
import type { PublicReview } from "@/db/queries/reviews";

/**
 * The profile's Reviews section (reviews v1, 2026-11-22): first-party reviews
 * of completed lessons, newest first, the reviewer as first name and last
 * initial. Rendered only when the tutor has at least one published review;
 * nothing stands in for an empty list (SPEC "Banned tells": no invented
 * ratings, no "0.0").
 */
export function ReviewList({
  reviews,
  ratingAvg,
  ratingCount,
}: {
  reviews: PublicReview[];
  ratingAvg: number;
  ratingCount: number;
}) {
  const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });
  return (
    <div className="grid gap-4">
      <RatingStars value={ratingAvg} count={ratingCount} size="lg" />
      <ul className="grid gap-4">
        {reviews.map((r) => (
          <li key={r.id} className="grid gap-1.5 border-t border-border pt-4 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <RatingStars value={r.rating} size="sm" showValue={false} />
              <span className="text-small font-medium text-text">{r.reviewer}</span>
              <span className="text-small text-text-muted">{dateFmt.format(r.createdAt)}</span>
            </div>
            {r.comment && <p className="max-w-[68ch] whitespace-pre-line text-body text-text">{r.comment}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
