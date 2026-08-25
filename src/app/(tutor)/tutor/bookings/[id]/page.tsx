import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { getBookingDetailForParticipant } from "@/db/queries/bookings";
import { BookingDetailView } from "@/components/features/booking/booking-detail-view";

export const metadata = { title: "Booking · NowTutors" };
export const dynamic = "force-dynamic";

/** /tutor/bookings/[id] — tutor booking detail (SPEC §6). Non-participants 404. */
export default async function TutorBookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { user } = await requireRole("tutor");
  const [booking, [me]] = await Promise.all([
    getBookingDetailForParticipant(id, user.id),
    db.select({ timezone: profiles.timezone }).from(profiles).where(eq(profiles.id, user.id)).limit(1),
  ]);
  if (!booking || booking.isStudent) notFound();

  return (
    <BookingDetailView
      booking={booking}
      viewerId={user.id}
      viewerTimeZone={me?.timezone ?? "UTC"}
      backHref="/tutor/bookings"
    />
  );
}
