"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/ui/field-error";
import { RatingStars } from "@/components/ui/rating-stars";
import { cn } from "@/lib/utils";
import { submitReview } from "@/actions/reviews";
import { REVIEW_COMMENT_MAX } from "@/lib/reviews/review";

const WORDS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];

/**
 * "How was your lesson?" on a completed booking (reviews v1, 2026-11-22).
 * Stars are a radio group, so the keyboard and screen readers get them for
 * free; the comment is optional. One review per lesson: once sent, the card
 * shows what the student gave instead of the form.
 */
export function ReviewForm({
  bookingId,
  tutorFirstName,
  existing,
}: {
  bookingId: string;
  tutorFirstName: string;
  existing: { rating: number; comment: string | null } | null;
}) {
  const router = useRouter();
  const [rating, setRating] = React.useState(0);
  const [hover, setHover] = React.useState(0);
  const [comment, setComment] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [sent, setSent] = React.useState<{ rating: number; comment: string | null } | null>(existing);

  if (sent) {
    return (
      <section aria-labelledby="review-title" className="grid gap-2 rounded-card border border-border p-4">
        <h2 id="review-title" className="font-display text-body-lg font-semibold text-text">
          Your review
        </h2>
        <RatingStars value={sent.rating} showValue={false} />
        {sent.comment && <p className="whitespace-pre-line text-body text-text">{sent.comment}</p>}
        <p className="text-small text-text-muted">Thanks. It helps other students choose.</p>
      </section>
    );
  }

  const shown = hover || rating;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rating < 1) {
      setError("Pick a star rating.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await submitReview({ bookingId, rating, comment });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setSent({ rating, comment: comment.trim() || null });
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      aria-labelledby="review-title"
      className="grid gap-3 rounded-card border border-border p-4"
    >
      <h2 id="review-title" className="font-display text-body-lg font-semibold text-text">
        How was your lesson with {tutorFirstName}?
      </h2>
      <fieldset>
        <legend className="sr-only">Rating out of 5</legend>
        <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="cursor-pointer" onMouseEnter={() => setHover(n)}>
              <input
                type="radio"
                name="rating"
                value={n}
                checked={rating === n}
                onChange={() => setRating(n)}
                className="peer sr-only"
              />
              <span className="sr-only">
                {n} {n === 1 ? "star" : "stars"}, {WORDS[n]}
              </span>
              <Star
                aria-hidden
                className={cn(
                  "size-7 fill-current rounded-sm peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent",
                  n <= shown ? "text-text" : "text-border",
                )}
              />
            </label>
          ))}
          <span className="ml-2 text-small text-text-muted" aria-hidden>
            {WORDS[shown]}
          </span>
        </div>
      </fieldset>
      <div className="grid gap-1.5">
        <Label htmlFor="review-comment">What went well, or what could be better? (optional)</Label>
        <Textarea
          id="review-comment"
          rows={3}
          maxLength={REVIEW_COMMENT_MAX}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>
      <FieldError>{error}</FieldError>
      <div>
        <Button type="submit" loading={pending}>
          Send review
        </Button>
      </div>
    </form>
  );
}
