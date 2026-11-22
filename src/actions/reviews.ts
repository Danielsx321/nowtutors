"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLog, bookings, reviews, tutorProfiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { reviewInputSchema, type ReviewInput } from "@/lib/reviews/review";

export type ReviewActionResult = { error: string } | { ok: true };

/**
 * Reviews v1 (drizzle/0031, SPEC §4.3; DECISIONS 2026-11-22).
 *
 * A student reviews a lesson they had: the booking must be theirs and
 * `completed`, and each booking takes one review. The actor comes from the
 * guard, never the client; the booking's tutor is read from the booking, not
 * sent. Writes run on the trusted Drizzle connection (there is no client write
 * policy), and the table's own guard re-checks the booking, so a bug here
 * still can't attach a review to someone else's lesson. The rating trigger
 * keeps tutor_profiles.rating_avg / rating_count in step.
 */
export async function submitReview(input: ReviewInput): Promise<ReviewActionResult> {
  const { user } = await requireRole("student");
  const parsed = reviewInputSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check your review." };
  const { bookingId, rating, comment } = parsed.data;

  const [booking] = await db
    .select({ studentId: bookings.studentId, tutorId: bookings.tutorId, status: bookings.status })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!booking || booking.studentId !== user.id) return { error: "Booking not found." };
  if (booking.status !== "completed") return { error: "You can review a lesson once it has finished." };

  const inserted = await db
    .insert(reviews)
    .values({ bookingId, studentId: user.id, tutorId: booking.tutorId, rating, comment })
    .onConflictDoNothing({ target: reviews.bookingId })
    .returning({ id: reviews.id });
  if (inserted.length === 0) return { error: "You have already reviewed this lesson." };

  const [tp] = await db
    .select({ slug: tutorProfiles.slug })
    .from(tutorProfiles)
    .where(eq(tutorProfiles.userId, booking.tutorId))
    .limit(1);
  revalidatePath(`/dashboard/bookings/${bookingId}`);
  if (tp) revalidatePath(`/tutors/${tp.slug}`);
  return { ok: true };
}

const publishSchema = z.object({ reviewId: z.string().uuid(), published: z.boolean() });

/**
 * Admin hide / show (/admin/reviews). A hidden review leaves the profile and
 * the tutor's average (the trigger recomputes); it is never deleted, so a
 * mistaken hide is one click to undo. Audited like every admin action.
 */
export async function setReviewPublished(input: {
  reviewId: string;
  published: boolean;
}): Promise<ReviewActionResult> {
  const { user } = await requireRole("admin");
  const parsed = publishSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid review." };
  const { reviewId, published } = parsed.data;

  const done = await db.transaction(async (tx) => {
    const updated = await tx
      .update(reviews)
      .set({ isPublished: published })
      .where(eq(reviews.id, reviewId))
      .returning({ tutorId: reviews.tutorId });
    if (updated.length === 0) return null;
    await tx.insert(auditLog).values({
      actorId: user.id,
      action: published ? "review.show" : "review.hide",
      targetType: "review",
      targetId: reviewId,
      payload: { tutorId: updated[0].tutorId },
    });
    return updated[0].tutorId;
  });
  if (!done) return { error: "Review not found." };

  const [tp] = await db
    .select({ slug: tutorProfiles.slug })
    .from(tutorProfiles)
    .where(eq(tutorProfiles.userId, done))
    .limit(1);
  revalidatePath("/admin/reviews");
  if (tp) revalidatePath(`/tutors/${tp.slug}`);
  return { ok: true };
}
