import "server-only";
import { and, asc, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { profiles, tutorProfiles } from "@/db/schema";
import { getTutorSubjects, type TutorSubjectEntry } from "./tutor-profile";

/** `tutor_approval_status` (drizzle/0000 + 0025). */
export type TutorApprovalStatus = "pending" | "approved" | "rejected" | "changes_requested";

export interface AdminTutorRow {
  userId: string;
  slug: string;
  displayName: string | null;
  email: string;
  avatarUrl: string | null;
  country: string | null;
  headline: string | null;
  about: string | null;
  introVideoUrl: string | null;
  education: string | null;
  yearsExperience: number | null;
  languages: string[];
  hourlyRateCredits: number;
  approvalStatus: TutorApprovalStatus;
  approvalNote: string | null;
  createdAt: Date;
  profileChangedAt: Date | null;
  profileReviewedAt: Date | null;
  subjects: TutorSubjectEntry[];
}

const baseColumns = {
  userId: tutorProfiles.userId,
  slug: tutorProfiles.slug,
  displayName: profiles.displayName,
  email: profiles.email,
  avatarUrl: profiles.avatarUrl,
  country: profiles.country,
  headline: tutorProfiles.headline,
  about: tutorProfiles.about,
  introVideoUrl: tutorProfiles.introVideoUrl,
  education: tutorProfiles.education,
  yearsExperience: tutorProfiles.yearsExperience,
  languages: tutorProfiles.languages,
  hourlyRateCredits: tutorProfiles.hourlyRateCredits,
  approvalStatus: tutorProfiles.approvalStatus,
  approvalNote: tutorProfiles.approvalNote,
  createdAt: tutorProfiles.createdAt,
  profileChangedAt: tutorProfiles.profileChangedAt,
  profileReviewedAt: tutorProfiles.profileReviewedAt,
};

async function withSubjects(
  rows: Array<Omit<AdminTutorRow, "subjects" | "languages"> & { languages: string[] | null }>,
): Promise<AdminTutorRow[]> {
  return Promise.all(
    rows.map(async (r) => ({
      ...r,
      languages: r.languages ?? [],
      subjects: await getTutorSubjects(r.userId),
    })),
  );
}

/** Applications awaiting a first decision — oldest first (fairest queue order). */
export async function getPendingTutors(): Promise<AdminTutorRow[]> {
  const rows = await db
    .select(baseColumns)
    .from(tutorProfiles)
    .innerJoin(profiles, eq(profiles.id, tutorProfiles.userId))
    .where(eq(tutorProfiles.approvalStatus, "pending"))
    .orderBy(asc(tutorProfiles.createdAt));
  return withSubjects(rows);
}

/**
 * Approved tutors who have changed a MATERIAL field since the last review
 * (SPEC §4.1). They remain live and bookable — this queue is a follow-up check,
 * not a gate. Needs re-review = profile_changed_at is not null AND
 * (profile_reviewed_at is null OR profile_reviewed_at < profile_changed_at).
 */
export async function getChangedTutors(): Promise<AdminTutorRow[]> {
  const rows = await db
    .select(baseColumns)
    .from(tutorProfiles)
    .innerJoin(profiles, eq(profiles.id, tutorProfiles.userId))
    .where(
      and(
        eq(tutorProfiles.approvalStatus, "approved"),
        isNotNull(tutorProfiles.profileChangedAt),
        or(
          sql`${tutorProfiles.profileReviewedAt} is null`,
          sql`${tutorProfiles.profileReviewedAt} < ${tutorProfiles.profileChangedAt}`,
        ),
      ),
    )
    .orderBy(desc(tutorProfiles.profileChangedAt));
  return withSubjects(rows);
}

/**
 * On hold and still waiting on the tutor (tutor-request-changes): status
 * `changes_requested` and no save since the hold. Newest hold first, so the
 * admin sees what they just did at the top.
 */
export async function getOnHoldTutors(): Promise<AdminTutorRow[]> {
  const rows = await db
    .select(baseColumns)
    .from(tutorProfiles)
    .innerJoin(profiles, eq(profiles.id, tutorProfiles.userId))
    .where(
      and(
        eq(tutorProfiles.approvalStatus, "changes_requested"),
        or(
          sql`${tutorProfiles.profileChangedAt} is null`,
          sql`${tutorProfiles.profileReviewedAt} is null`,
          sql`${tutorProfiles.profileChangedAt} <= ${tutorProfiles.profileReviewedAt}`,
        ),
      ),
    )
    .orderBy(desc(tutorProfiles.profileReviewedAt));
  return withSubjects(rows);
}

/**
 * On hold and saved since (tutor-request-changes): the tutor has done what was
 * asked, or at least something, and wants another look. Oldest resubmit first,
 * the same fairness as the pending queue.
 */
export async function getResubmittedTutors(): Promise<AdminTutorRow[]> {
  const rows = await db
    .select(baseColumns)
    .from(tutorProfiles)
    .innerJoin(profiles, eq(profiles.id, tutorProfiles.userId))
    .where(
      and(
        eq(tutorProfiles.approvalStatus, "changes_requested"),
        isNotNull(tutorProfiles.profileChangedAt),
        isNotNull(tutorProfiles.profileReviewedAt),
        sql`${tutorProfiles.profileChangedAt} > ${tutorProfiles.profileReviewedAt}`,
      ),
    )
    .orderBy(asc(tutorProfiles.profileChangedAt));
  return withSubjects(rows);
}
