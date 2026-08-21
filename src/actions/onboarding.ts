"use server";

import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  profiles,
  subjects,
  tutorProfiles,
  tutorSubjects,
  tutorPayoutDetails,
  studentSubjects,
} from "@/db/schema";
import { requireUser, getSessionProfile, homeFor } from "@/lib/auth/guards";
import {
  studentOnboardingSchema,
  tutorOnboardingSchema,
  type StudentOnboardingValues,
  type TutorOnboardingValues,
} from "@/lib/auth/schemas";

export type OnboardingResult = { error: string };

/**
 * Onboarding writes multiple related rows (profile + role, plus interests or the
 * tutor profile/subjects/payout), so they run in ONE drizzle transaction for
 * atomicity. The authoritative id is ALWAYS the guard-authenticated user's id —
 * never a client-supplied value (SPEC §5). RLS remains the backstop for any
 * direct client path; here the guard is Layer 2 and the transaction is atomic.
 * Role is set once here (NULL → value); the profiles_guard trigger + this check
 * make it immutable afterwards.
 */
async function requireUnonboarded() {
  const user = await requireUser(); // redirects to /login if not signed in
  const p = await getSessionProfile();
  if (!p) redirect("/login");
  if (p.role != null) redirect(homeFor[p.role]); // already onboarded — role is immutable
  return user;
}

/** Resolve active subject slugs to their ids; unknown/inactive slugs are dropped. */
async function subjectIdsForSlugs(slugs: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(slugs)).filter(Boolean);
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ id: subjects.id, slug: subjects.slug })
    .from(subjects)
    .where(and(inArray(subjects.slug, unique), eq(subjects.isActive, true)));
  return new Map(rows.map((r) => [r.slug, r.id]));
}

export async function completeStudentOnboarding(
  values: StudentOnboardingValues,
): Promise<OnboardingResult> {
  const user = await requireUnonboarded();

  const parsed = studentOnboardingSchema.safeParse(values); // server re-validates
  if (!parsed.success) return { error: "Please check the form and try again." };
  const v = parsed.data;

  const slugToId = await subjectIdsForSlugs(v.subjects);

  await db.transaction(async (tx) => {
    await tx
      .update(profiles)
      .set({
        role: "student",
        fullName: v.fullName,
        displayName: v.fullName,
        timezone: v.timezone,
        avatarUrl: v.avatarUrl ?? null,
        onboardingCompletedAt: new Date(),
      })
      .where(eq(profiles.id, user.id));

    if (slugToId.size > 0) {
      await tx
        .insert(studentSubjects)
        .values(
          Array.from(slugToId.values()).map((subjectId) => ({
            studentId: user.id,
            subjectId,
          })),
        )
        .onConflictDoNothing();
    }
  });

  redirect("/dashboard");
}

/** A URL-safe, unique tutor slug derived from the display name. */
async function uniqueTutorSlug(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) || "tutor";
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const [taken] = await db
      .select({ slug: tutorProfiles.slug })
      .from(tutorProfiles)
      .where(eq(tutorProfiles.slug, candidate))
      .limit(1);
    if (!taken) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function completeTutorOnboarding(
  values: TutorOnboardingValues,
): Promise<OnboardingResult> {
  const user = await requireUnonboarded();

  const parsed = tutorOnboardingSchema.safeParse(values); // server re-validates
  if (!parsed.success) return { error: "Please check the form and try again." };
  const v = parsed.data;

  const slugToId = await subjectIdsForSlugs(v.subjects.map((s) => s.slug));
  if (slugToId.size === 0) {
    return { error: "Select at least one subject you teach." };
  }
  const slug = await uniqueTutorSlug(v.fullName);

  await db.transaction(async (tx) => {
    await tx
      .update(profiles)
      .set({
        role: "tutor",
        fullName: v.fullName,
        displayName: v.fullName,
        avatarUrl: v.avatarUrl ?? null,
        onboardingCompletedAt: new Date(),
      })
      .where(eq(profiles.id, user.id));

    // approval_status is intentionally NOT set → column default 'pending'. Only
    // an admin (service role) may move it to 'approved' (SPEC §5, RLS).
    await tx.insert(tutorProfiles).values({
      userId: user.id,
      slug,
      headline: v.headline,
      about: v.about,
      hourlyRateCredits: v.hourlyRateCredits,
      languages: v.languages,
      education: v.education ?? null,
      yearsExperience: v.yearsExperience ?? null,
    });

    const rows = v.subjects
      .map((s) => ({ slug: s.slug, level: s.level }))
      .filter((s) => slugToId.has(s.slug))
      .map((s) => ({
        tutorId: user.id,
        subjectId: slugToId.get(s.slug)!,
        level: s.level,
      }));
    if (rows.length > 0) {
      await tx.insert(tutorSubjects).values(rows).onConflictDoNothing();
    }

    await tx.insert(tutorPayoutDetails).values({
      tutorId: user.id,
      payoutMethod: "paypal",
      paypalEmail: v.paypalEmail,
    });
  });

  redirect("/tutor/pending-approval");
}
