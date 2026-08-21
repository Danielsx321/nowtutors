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

/** Thrown by requireVerifiedEmail so the calling action can 403 rather than
 *  redirect. Email verification gates booking/going-live (§7.1), not browsing. */
export class EmailNotVerifiedError extends Error {
  constructor() {
    super("Please verify your email address to continue.");
    this.name = "EmailNotVerifiedError";
  }
}

export function isEmailVerified(
  user: { email_confirmed_at?: string | null; confirmed_at?: string | null } | null,
): boolean {
  return !!(user?.email_confirmed_at || user?.confirmed_at);
}

/**
 * Server-side email-verification gate (SPEC §7.1: required before booking or
 * going live; browsing/onboarding do not require it). The booking (Phase 4) and
 * go-live (Phase 6) actions call this as an authorization check — never rely on
 * hiding the button. Returns the verified user or throws EmailNotVerifiedError.
 */
export async function requireVerifiedEmail() {
  const user = await requireUser();
  if (!isEmailVerified(user)) throw new EmailNotVerifiedError();
  return user;
}

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

/** For public auth pages (login/signup/forgot): a signed-in user has no reason
 *  to be here — send them to onboarding (role unset) or their home. NOT used on
 *  /reset-password, which legitimately runs inside the recovery session. */
export async function redirectIfSignedIn() {
  const p = await getSessionProfile();
  if (p) redirect(p.role ? homeFor[p.role] : "/onboarding");
}

export async function requireOnboarded() {
  const p = await getSessionProfile();
  if (!p) redirect("/login");
  if (p.role == null) redirect("/onboarding");
  return p;
}

/**
 * Require a specific role (SPEC §5 Layer 2). Used both in the area layouts AND
 * as the first line of every action/route in that area. For tutors it also
 * enforces approval by default (unapproved → /tutor/pending-approval); pass
 * `{ requireApproval: false }` in the (tutor) LAYOUT so /tutor/pending-approval
 * itself doesn't redirect-loop — that page checks approval on its own.
 */
export async function requireRole(
  role: Role,
  opts: { requireApproval?: boolean } = {},
) {
  const user = await requireUser();
  const p = await getSessionProfile();
  if (!p || p.role == null) redirect("/onboarding");
  if (p.isSuspended) redirect("/suspended");
  if (p.role !== role) redirect(homeFor[p.role]);
  if (role === "tutor" && (opts.requireApproval ?? true)) {
    const [tp] = await db
      .select({ approval: tutorProfiles.approvalStatus })
      .from(tutorProfiles)
      .where(eq(tutorProfiles.userId, user.id))
      .limit(1);
    if (!tp || tp.approval !== "approved") redirect("/tutor/pending-approval");
  }
  return { user, profile: p };
}
