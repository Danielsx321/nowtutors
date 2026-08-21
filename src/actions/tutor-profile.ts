"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { profiles, subjects, tutorProfiles, tutorSubjects } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import {
  tutorProfileEditSchema,
  type TutorProfileEditValues,
} from "@/lib/auth/schemas";

export type UpdateResult = { error: string } | { ok: true };

/**
 * Update the signed-in tutor's own profile (SPEC §6 /tutor/profile).
 *
 * Guard first (§5 Layer 2) — approval is NOT required, a pending tutor may still
 * edit their application. The tutor id comes from the guard, never from the
 * client, so there is no target to spoof.
 *
 * NOT editable here and never read off the input: approval_status,
 * approval_note, slug, role. The schema has no such fields, so extra keys are
 * dropped by the parse; the DB triggers (tutor_approval_guard, profiles_guard)
 * are the backstop if anyone bypasses the app.
 *
 * Re-review: an approved tutor's edit goes live immediately and
 * approval_status is untouched. The tutor_profile_change_flag trigger stamps
 * profile_changed_at IF a material field actually changed. Subjects are diffed
 * here rather than delete-all-reinsert precisely so that a no-op save issues no
 * child-table writes and therefore cannot flag (SPEC §4.1).
 */
export async function updateTutorProfile(
  values: TutorProfileEditValues,
): Promise<UpdateResult> {
  const { user } = await requireRole("tutor", { requireApproval: false });

  const parsed = tutorProfileEditSchema.safeParse(values); // server re-validates
  if (!parsed.success) return { error: "Please check the form and try again." };
  const v = parsed.data;

  // Resolve subject slugs → ids (active subjects only).
  const wanted = Array.from(new Set(v.subjects.map((s) => s.slug)));
  const subjectRows = wanted.length
    ? await db
        .select({ id: subjects.id, slug: subjects.slug })
        .from(subjects)
        .where(and(inArray(subjects.slug, wanted), eq(subjects.isActive, true)))
    : [];
  const idForSlug = new Map(subjectRows.map((r) => [r.slug, r.id]));
  const desired = new Map<string, string>(); // subjectId -> level
  for (const s of v.subjects) {
    const id = idForSlug.get(s.slug);
    if (id) desired.set(id, s.level);
  }
  if (desired.size === 0) {
    return { error: "Select at least one subject you teach." };
  }

  const existing = await db
    .select({ subjectId: tutorSubjects.subjectId, level: tutorSubjects.level })
    .from(tutorSubjects)
    .where(eq(tutorSubjects.tutorId, user.id));
  const current = new Map(existing.map((r) => [r.subjectId, r.level]));

  const toInsert = [...desired].filter(([id]) => !current.has(id));
  const toDelete = [...current.keys()].filter((id) => !desired.has(id));
  const toUpdate = [...desired].filter(
    ([id, level]) => current.has(id) && current.get(id) !== level,
  );

  await db.transaction(async (tx) => {
    await tx
      .update(tutorProfiles)
      .set({
        headline: v.headline,
        about: v.about,
        hourlyRateCredits: v.hourlyRateCredits,
        introVideoUrl: v.introVideoUrl ?? null,
        languages: v.languages,
        education: v.education ?? null,
        yearsExperience: v.yearsExperience ?? null,
      })
      .where(eq(tutorProfiles.userId, user.id));

    // Name + avatar live on profiles, not tutor_profiles.
    await tx
      .update(profiles)
      .set({
        fullName: v.fullName,
        displayName: v.fullName,
        avatarUrl: v.avatarUrl ?? null,
      })
      .where(eq(profiles.id, user.id));

    if (toDelete.length) {
      await tx
        .delete(tutorSubjects)
        .where(
          and(
            eq(tutorSubjects.tutorId, user.id),
            inArray(tutorSubjects.subjectId, toDelete),
          ),
        );
    }
    if (toInsert.length) {
      await tx.insert(tutorSubjects).values(
        toInsert.map(([subjectId, level]) => ({
          tutorId: user.id,
          subjectId,
          level: level as "beginner" | "intermediate" | "advanced" | "all",
        })),
      );
    }
    for (const [subjectId, level] of toUpdate) {
      await tx
        .update(tutorSubjects)
        .set({ level: level as "beginner" | "intermediate" | "advanced" | "all" })
        .where(
          and(
            eq(tutorSubjects.tutorId, user.id),
            eq(tutorSubjects.subjectId, subjectId),
          ),
        );
    }
  });

  revalidatePath("/tutor/profile");
  revalidatePath("/");
  return { ok: true };
}
