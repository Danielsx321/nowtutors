import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { getBookingDetailForParticipant } from "@/db/queries/bookings";
import { BookingDetailView } from "@/components/features/booking/booking-detail-view";
import { MessageTutorButton } from "@/components/features/messaging/message-tutor-button";
import { getReviewForBooking } from "@/db/queries/reviews";
import { ReviewForm } from "@/components/features/reviews/review-form";

export const metadata = { title: "Booking · NowTutors" };
export const dynamic = "force-dynamic";

/** /dashboard/bookings/[id] — student booking detail (SPEC §6). The query
 *  returns null for a non-participant, so a stranger's booking 404s. */
export default async function StudentBookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { user } = await requireRole("student");
  const [booking, [me]] = await Promise.all([
    getBookingDetailForParticipant(id, user.id),
    db.select({ timezone: profiles.timezone }).from(profiles).where(eq(profiles.id, user.id)).limit(1),
  ]);
  if (!booking || !booking.isStudent) notFound();

  // Reviews v1 (2026-11-22): a completed lesson asks for one review.
  const review = booking.status === "completed" ? await getReviewForBooking(booking.id) : null;
  const tutorFirstName = booking.otherPartyName?.trim().split(/\s+/)[0] || "your tutor";

  return (
    <BookingDetailView
      booking={booking}
      viewerId={user.id}
      viewerTimeZone={me?.timezone ?? "UTC"}
      backHref="/dashboard/bookings"
      messageAction={
        <MessageTutorButton
          tutorId={booking.tutorId}
          signedIn
          loginHref={`/login?next=/dashboard/bookings/${booking.id}`}
          className="w-full sm:w-auto"
        />
      }
      footer={
        booking.status === "completed" ? (
          <ReviewForm
            bookingId={booking.id}
            tutorFirstName={tutorFirstName}
            existing={review ? { rating: review.rating, comment: review.comment } : null}
          />
        ) : undefined
      }
    />
  );
}
