import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import {
  getBookingsForParticipant,
  groupBookingsByTab,
} from "@/db/queries/bookings";
import { BookingList } from "@/components/features/booking/booking-list";

export const metadata = { title: "Bookings · NowTutors" };
export const dynamic = "force-dynamic";

/** /tutor/bookings — the tutor's scheduled sessions (SPEC §6). RLS scopes to
 *  participants; requireRole re-checks the tutor role + approval (§5 Layer 2). */
export default async function TutorBookingsPage() {
  const { user } = await requireRole("tutor");
  const [items, [me]] = await Promise.all([
    getBookingsForParticipant(user.id, "tutor"),
    db.select({ timezone: profiles.timezone }).from(profiles).where(eq(profiles.id, user.id)).limit(1),
  ]);

  return (
    <div className="mx-auto max-w-3xl py-8">
      <h1 className="mb-6 text-h1 font-bold text-gray-700">Bookings</h1>
      <BookingList
        groups={groupBookingsByTab(items)}
        basePath="/tutor/bookings"
        counterpartLabel="Student"
        viewerTimeZone={me?.timezone ?? "UTC"}
      />
    </div>
  );
}
