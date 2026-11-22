import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { bookings, profiles, reviews, subjects, tutorProfiles } from "@/db/schema";
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

export interface LessonToReview {
  bookingId: string;
  tutorName: string | null;
  tutorAvatarUrl: string | null;
  subjectName: string | null;
  endedAt: Date;
}

/** How far back the dashboard asks for a review (days after the lesson ended). */
export const REVIEW_PROMPT_DAYS = 30;

/**
 * The student's completed lessons from the last {@link REVIEW_PROMPT_DAYS}
 * days with no review yet, newest first: the dashboard's "Rate your lessons"
 * prompt. Instant and scheduled both count. A lesson drops off once reviewed
 * or once it is older than the window, so the prompt never nags forever.
 */
export async function getLessonsToReview(studentId: string, limit = 3, now = new Date()): Promise<LessonToReview[]> {
  const ended = sql<Date>`coalesce(${bookings.endedAt}, ${bookings.scheduledEndAt}, ${bookings.createdAt})`;
  const since = new Date(now.getTime() - REVIEW_PROMPT_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      bookingId: bookings.id,
      tutorName: profiles.displayName,
      tutorAvatarUrl: profiles.avatarUrl,
      subjectName: subjects.name,
      endedAt: ended,
    })
    .from(bookings)
    .innerJoin(profiles, eq(profiles.id, bookings.tutorId))
    .leftJoin(subjects, eq(subjects.id, bookings.subjectId))
    .leftJoin(reviews, eq(reviews.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.studentId, studentId),
        eq(bookings.status, "completed"),
        isNull(reviews.id),
        sql`${ended} > ${since.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(desc(ended))
    .limit(limit);
  return rows.map((r) => ({ ...r, endedAt: new Date(r.endedAt) }));
}
