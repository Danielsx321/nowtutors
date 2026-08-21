import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { subjects as subjectsTable, profiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { getOwnTutorProfile, getTutorSubjects } from "@/db/queries/tutor-profile";
import { TutorProfileEditor } from "@/components/features/tutor/profile-editor";
import { Alert } from "@/components/ui/alert";
import type { TutorProfileEditValues } from "@/lib/auth/schemas";
import type { Language } from "@/lib/geo/languages";

export const metadata = { title: "Your profile · NowTutors" };
export const dynamic = "force-dynamic";

/**
 * The tutor's own public-profile editor (SPEC §6). Guarded with
 * requireRole('tutor') — approval NOT required, since a pending tutor should
 * still be able to correct their application. The update action re-checks.
 */
export default async function TutorProfileEditPage() {
  const { user } = await requireRole("tutor", { requireApproval: false });

  const [tp, subjectRows, ownSubjects, [me]] = await Promise.all([
    getOwnTutorProfile(user.id),
    db
      .select({ slug: subjectsTable.slug, name: subjectsTable.name })
      .from(subjectsTable)
      .where(eq(subjectsTable.isActive, true))
      .orderBy(asc(subjectsTable.sortOrder)),
    getTutorSubjects(user.id),
    db
      .select({ fullName: profiles.fullName, displayName: profiles.displayName, avatarUrl: profiles.avatarUrl })
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .limit(1),
  ]);

  if (!tp) {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <Alert variant="warning" title="No tutor profile yet">
          Finish onboarding to create your tutor profile.
        </Alert>
      </div>
    );
  }

  const defaults: TutorProfileEditValues = {
    fullName: me?.displayName ?? me?.fullName ?? "",
    avatarUrl: me?.avatarUrl ?? undefined,
    headline: tp.headline ?? "",
    about: tp.about ?? "",
    subjects: ownSubjects.map((s) => ({
      slug: s.slug,
      level: (s.level ?? "all") as "beginner" | "intermediate" | "advanced" | "all",
    })),
    hourlyRateCredits: tp.hourlyRateCredits,
    languages: (tp.languages ?? []) as Language[],
    education: tp.education ?? undefined,
    yearsExperience: tp.yearsExperience ?? undefined,
    introVideoUrl: tp.introVideoUrl ?? undefined,
  };

  const isApproved = tp.approvalStatus === "approved";

  return (
    <div className="mx-auto max-w-2xl py-8">
      <div className="mb-6 space-y-1">
        <h1 className="text-h1 font-bold text-gray-700">Your profile</h1>
        <p className="text-body text-gray-500">
          This is what students see on your public page.
        </p>
      </div>

      {isApproved && (
        <div className="mb-6">
          <Alert variant="info">
            Changes go live immediately. Edits to your headline, about, subjects,
            rate or intro video are re-checked by our team afterwards — you stay
            visible and bookable throughout.
          </Alert>
        </div>
      )}

      <TutorProfileEditor
        userId={user.id}
        subjects={subjectRows}
        defaults={defaults}
        isApproved={isApproved}
      />
    </div>
  );
}
