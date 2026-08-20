import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { profiles, tutorProfiles } from "@/db/schema";

/**
 * SPEC §5 Layer 2 — server-side authorization. These run in layouts AND are
 * re-checked first in every Server Action / route handler; never trust the
 * layout alone. Role is set once at onboarding and is not user-changeable
 * (the drizzle/0003 profiles_guard trigger is the DB backstop).
 */

export type Role = "student" | "tutor" | "admin";

export const homeFor: Record<Role, string> = {
  student: "/dashboard",
  tutor: "/tutor",
  admin: "/admin",
};

/** Current auth user (validates the JWT, not just the cookie). Memoized/request. */
export const getUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
});

export interface SessionProfile {
  id: string;
  role: Role | null;
  onboardingCompletedAt: Date | null;
  isSuspended: boolean;
}

export const getSessionProfile = cache(async (): Promise<SessionProfile | null> => {
  const user = await getUser();
  if (!user) return null;
  const [p] = await db
    .select({
      id: profiles.id,
      role: profiles.role,
      onboardingCompletedAt: profiles.onboardingCompletedAt,
      isSuspended: profiles.isSuspended,
    })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);
  return (p as SessionProfile) ?? null;
});

/** Lightweight viewer context for public pages (browse favourite state). */
export const getViewer = cache(async () => {
  const p = await getSessionProfile();
  return p ? { userId: p.id, role: p.role } : null;
});

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireOnboarded() {
  const p = await getSessionProfile();
  if (!p) redirect("/login");
  if (p.role == null) redirect("/onboarding");
  return p;
}

export async function requireRole(role: Role) {
  const user = await requireUser();
  const p = await getSessionProfile();
  if (!p || p.role == null) redirect("/onboarding");
  if (p.isSuspended) redirect("/suspended");
  if (p.role !== role) redirect(homeFor[p.role]);
  if (role === "tutor") {
    const [tp] = await db
      .select({ approval: tutorProfiles.approvalStatus })
      .from(tutorProfiles)
      .where(eq(tutorProfiles.userId, user.id))
      .limit(1);
    if (!tp || tp.approval !== "approved") redirect("/tutor/pending-approval");
  }
  return { user, profile: p };
}
