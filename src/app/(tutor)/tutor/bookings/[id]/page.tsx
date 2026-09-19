import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { MessageSquare } from "lucide-react";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { getBookingDetailForParticipant } from "@/db/queries/bookings";
import { findConversationBetween } from "@/db/queries/messaging";
import { BookingDetailView } from "@/components/features/booking/booking-detail-view";

export const metadata = { title: "Booking · NowTutors" };
export const dynamic = "force-dynamic";

/**
 * /tutor/bookings/[id] — tutor booking detail (SPEC §6). Non-participants 404.
 *
 * A tutor can't start a conversation (settled 2026-09-15), so this only links
 * to a thread the student has already opened. With none, there's no control.
 */
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

  const conversationId = await findConversationBetween(user.id, booking.studentId);

  return (
    <BookingDetailView
      booking={booking}
      viewerId={user.id}
      viewerTimeZone={me?.timezone ?? "UTC"}
      backHref="/tutor/bookings"
      messageAction={
        conversationId ? (
          <Link
            href={`/tutor/messages/${conversationId}`}
            className="focus-ring inline-flex h-11 items-center gap-2 rounded-md border border-border bg-surface-raised px-4 text-body font-medium text-text hover:bg-surface-muted"
          >
            <MessageSquare className="size-5" aria-hidden />
            Open conversation
          </Link>
        ) : undefined
      }
    />
  );
}
