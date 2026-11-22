import { z } from "zod";

/** Longest comment a student can leave (matches reviews_comment_len_chk, drizzle/0031). */
export const REVIEW_COMMENT_MAX = 1000;

export const reviewInputSchema = z.object({
  bookingId: z.string().uuid(),
  rating: z
    .number({ message: "Pick a star rating." })
    .int("Pick a star rating.")
    .min(1, "Pick a star rating.")
    .max(5, "Pick a star rating."),
  comment: z
    .string()
    .trim()
    .max(REVIEW_COMMENT_MAX, `Keep it under ${REVIEW_COMMENT_MAX.toLocaleString()} characters.`)
    .optional()
    .transform((c) => (c ? c : null)),
});
export type ReviewInput = z.input<typeof reviewInputSchema>;

/**
 * How a reviewer is named in public: first name and last initial ("Ada O."),
 * so a review reads as a real person without showing a student's full name.
 * Falls back to "A student" when the profile has no usable name.
 */
export function reviewerName(fullName: string | null | undefined, displayName?: string | null): string {
  const parts = (fullName?.trim() || displayName?.trim() || "").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "A student";
  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  return last ? `${first} ${last[0].toUpperCase()}.` : first;
}

/** "4.8" for a card or a profile, from the numeric(3,2) column. */
export function formatRating(avg: number | string): string {
  return Number(avg).toFixed(1);
}
