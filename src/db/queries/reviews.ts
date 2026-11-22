import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles, reviews, tutorProfiles } from "@/db/schema";
import { reviewerName } from "@/lib/reviews/review";

export interface PublicReview {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: Date;
  reviewer: string;
}

/** Published reviews of one tutor, newest first (the profile's Reviews section). */
export async function getPublishedReviewsForTutor(tutorId: string, limit = 20): Promise<PublicReview[]> {
  const rows = await db
    .select({
      id: reviews.id,
      rating: reviews.rating,
      comment: reviews.comment,
      createdAt: reviews.createdAt,
      fullName: profiles.fullName,
      displayName: profiles.displayName,
    })
    .from(reviews)
    .innerJoin(profiles, eq(profiles.id, reviews.studentId))
    .where(and(eq(reviews.tutorId, tutorId), eq(reviews.isPublished, true)))
    .orderBy(desc(reviews.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    createdAt: r.createdAt,
    reviewer: reviewerName(r.fullName, r.displayName),
  }));
}

/** The student's own review of a booking, if they left one. */
export async function getReviewForBooking(bookingId: string) {
  const [row] = await db
    .select({ id: reviews.id, rating: reviews.rating, comment: reviews.comment, isPublished: reviews.isPublished })
    .from(reviews)
    .where(eq(reviews.bookingId, bookingId))
    .limit(1);
  return row ?? null;
}

export interface AdminReviewRow {
  id: string;
  rating: number;
  comment: string | null;
  isPublished: boolean;
  createdAt: Date;
  reviewer: string;
  tutorName: string | null;
  tutorSlug: string;
}

/** Newest reviews across the site, hidden ones included (/admin/reviews). */
export async function getRecentReviewsForAdmin(limit = 100): Promise<AdminReviewRow[]> {
  const student = db
    .select({ id: profiles.id, fullName: profiles.fullName, displayName: profiles.displayName })
    .from(profiles)
    .as("student");
  const rows = await db
    .select({
      id: reviews.id,
      rating: reviews.rating,
      comment: reviews.comment,
      isPublished: reviews.isPublished,
      createdAt: reviews.createdAt,
      studentFull: student.fullName,
      studentDisplay: student.displayName,
      tutorName: profiles.displayName,
      tutorSlug: tutorProfiles.slug,
    })
    .from(reviews)
    .innerJoin(student, eq(student.id, reviews.studentId))
    .innerJoin(profiles, eq(profiles.id, reviews.tutorId))
    .innerJoin(tutorProfiles, eq(tutorProfiles.userId, reviews.tutorId))
    .orderBy(desc(reviews.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    isPublished: r.isPublished,
    createdAt: r.createdAt,
    reviewer: reviewerName(r.studentFull, r.studentDisplay),
    tutorName: r.tutorName,
    tutorSlug: r.tutorSlug,
  }));
}
