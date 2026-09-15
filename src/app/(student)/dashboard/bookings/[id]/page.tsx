import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { getBookingDetailForParticipant } from "@/db/queries/bookings";
import { BookingDetailView } from "@/components/features/booking/booking-detail-view";
import { MessageTutorButton } from "@/components/features/messaging/message-tutor-button";

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
    />
  );
}
