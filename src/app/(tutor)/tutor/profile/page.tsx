import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { subjects as subjectsTable, profiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { getOwnTutorProfile, getTutorSubjects } from "@/db/queries/tutor-profile";
import { TutorProfileEditor } from "@/components/features/tutor/profile-editor";
import { Alert } from "@/components/ui/alert";
import type { TutorProfileEditValues } from "@/lib/auth/schemas";
import type { Language } from "@/lib/geo/languages";
import { changeReason, parseApprovalNote } from "@/lib/tutors/change-reasons";

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
      .select({
        fullName: profiles.fullName,
        displayName: profiles.displayName,
        avatarUrl: profiles.avatarUrl,
        country: profiles.country,
      })
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .limit(1),
  ]);

  if (!tp) {
    return (
      <div className="w-full py-2">
        <Alert variant="warning" title="No tutor profile yet">
          Finish onboarding to create your tutor profile.
        </Alert>
      </div>
    );
  }

  const defaults: TutorProfileEditValues = {
    fullName: me?.displayName ?? me?.fullName ?? "",
    avatarUrl: me?.avatarUrl ?? "",
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
  const onHold = tp.approvalStatus === "changes_requested";
  const asked = onHold ? parseApprovalNote(tp.approvalNote) : null;

  return (
    <div className="w-full py-2">
      <div className="mb-6 space-y-1">
        <h1 className="font-display text-[clamp(28px,3vw,38px)] font-medium leading-tight tracking-[-0.03em] text-text">Your profile</h1>
        <p className="text-body text-text-muted">
          This is what students see on your public page.
        </p>
      </div>

      {asked && (
        <div className="mb-6">
          <Alert variant="warning" title="Changes requested">
            <p>Your profile is paused while you make these changes. Save when you&rsquo;re done and we&rsquo;ll take another look.</p>
            {asked.reasons.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {asked.reasons.map((k) => {
                  const r = changeReason(k);
                  return (
                    <li key={k}>
                      <span className="font-medium">{r.label}.</span> {r.guidance}
                    </li>
                  );
                })}
              </ul>
            )}
            {asked.note && <p className="mt-2 whitespace-pre-line">{asked.note}</p>}
          </Alert>
        </div>
      )}

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
        onHold={onHold}
        preview={{ slug: tp.slug, country: me?.country ?? null, completedSessions: tp.completedSessions }}
      />
    </div>
  );
}
