import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import {
  getBookingsForParticipant,
  groupBookingsByTab,
} from "@/db/queries/bookings";
import { BookingList } from "@/components/features/booking/booking-list";

export const metadata = { title: "Your bookings · NowTutors" };
export const dynamic = "force-dynamic";

/** /dashboard/bookings — the student's sessions (SPEC §6). RLS scopes bookings
 *  to participants; requireRole re-checks the student role (§5 Layer 2). */
export default async function StudentBookingsPage() {
  const { user } = await requireRole("student");
  const [items, [me]] = await Promise.all([
    getBookingsForParticipant(user.id, "student"),
    db.select({ timezone: profiles.timezone }).from(profiles).where(eq(profiles.id, user.id)).limit(1),
  ]);

  return (
    <div className="mx-auto max-w-3xl py-8">
      <h1 className="mb-6 text-h1 font-bold text-gray-700">Your bookings</h1>
      <BookingList
        groups={groupBookingsByTab(items)}
        basePath="/dashboard/bookings"
        counterpartLabel="Tutor"
        viewerTimeZone={me?.timezone ?? "UTC"}
        emptyBrowseHref="/tutors"
      />
    </div>
  );
}
