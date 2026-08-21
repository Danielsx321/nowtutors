import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { subjects as subjectsTable } from "@/db/schema";
import { requireUser, getSessionProfile, homeFor } from "@/lib/auth/guards";
import { OnboardingFlow } from "@/components/features/onboarding/onboarding-flow";

export const metadata = { title: "Get started · NowTutors" };
export const dynamic = "force-dynamic"; // per-user, reads the session

export default async function OnboardingPage() {
  const user = await requireUser(); // → /login if not signed in
  const profile = await getSessionProfile();
  // Onboarding is a one-time step: once a role is set it is immutable (§7.1).
  if (profile?.role) redirect(homeFor[profile.role]);

  const subjectRows = await db
    .select({ slug: subjectsTable.slug, name: subjectsTable.name })
    .from(subjectsTable)
    .where(eq(subjectsTable.isActive, true))
    .orderBy(asc(subjectsTable.sortOrder));

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="mx-auto w-full max-w-xl rounded-lg border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
        <OnboardingFlow userId={user.id} subjects={subjectRows} />
      </div>
    </div>
  );
}
