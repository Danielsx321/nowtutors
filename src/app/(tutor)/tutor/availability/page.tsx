import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { getOwnAvailability } from "@/db/queries/availability";
import { AvailabilityEditor } from "@/components/features/tutor/availability-editor";

export const metadata = { title: "Availability · NowTutors" };
export const dynamic = "force-dynamic";

/** /tutor/availability — weekly rules + date exceptions editor (SPEC §6, §4.2).
 *  requireRole('tutor') re-checks role + approval (§5 Layer 2); the save action
 *  guards again and scopes every write to the signed-in tutor. */
export default async function TutorAvailabilityPage() {
  const { user } = await requireRole("tutor");
  const [{ rules, exceptions }, [me]] = await Promise.all([
    getOwnAvailability(user.id),
    db.select({ timezone: profiles.timezone }).from(profiles).where(eq(profiles.id, user.id)).limit(1),
  ]);

  return (
    <div className="mx-auto max-w-2xl py-8">
      <div className="mb-6 space-y-1">
        <h1 className="text-h1 font-bold text-gray-700">Availability</h1>
        <p className="text-body text-gray-500">
          Set the weekly hours students can book, plus any one-off exceptions.
        </p>
      </div>
      <AvailabilityEditor
        timezone={me?.timezone ?? "UTC"}
        initialRules={rules}
        initialExceptions={exceptions}
      />
    </div>
  );
}
