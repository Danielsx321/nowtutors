"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { tutorProfiles, auditLog } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";

export type AdminActionResult = { error: string } | { ok: true };

const approveSchema = z.object({ tutorId: z.string().uuid() });
const rejectSchema = z.object({
  tutorId: z.string().uuid(),
  note: z.string().trim().min(5, "A rejection note is required."),
});

/**
 * Admin approval queue actions (SPEC §6 /admin/tutors, §7.11 audit).
 *
 * Every one of these calls requireRole('admin') as its FIRST statement — the
 * layout guard is only a redirect (§5 Layer 2). The tutor id is validated as a
 * uuid but is a legitimate client input here (an admin acting on someone else);
 * the ACTOR is always taken from the guard, never from the client.
 *
 * Writes go through the trusted server-side connection: RLS on tutor_profiles is
 * owner-only, so an admin's own session cannot update another tutor's row, and
 * audit_log is service-role write (drizzle/0005). The approval trigger
 * recognises this path (drizzle/0012); Layer 2 above is its authorization.
 *
 * Approval EMAIL is Phase 10 — see the marked hook in each action. Nothing here
 * sends mail.
 */
export async function approveTutor(input: {
  tutorId: string;
}): Promise<AdminActionResult> {
  const { user } = await requireRole("admin");
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid tutor." };

  const [before] = await db
    .select({ status: tutorProfiles.approvalStatus })
    .from(tutorProfiles)
    .where(eq(tutorProfiles.userId, parsed.data.tutorId))
    .limit(1);
  if (!before) return { error: "Tutor not found." };

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(tutorProfiles)
      .set({
        approvalStatus: "approved",
        approvedAt: now,
        approvalNote: null,
        // Approving is itself a review of the current version.
        profileReviewedAt: now,
      })
      .where(eq(tutorProfiles.userId, parsed.data.tutorId));
    await tx.insert(auditLog).values({
      actorId: user.id,
      action: "tutor.approve",
      targetType: "tutor_profile",
      targetId: parsed.data.tutorId,
      payload: { from: before.status, to: "approved" },
    });
  });

  // TODO(Phase 10): send the "you're approved" email here (SPEC §11). Deliberately
  // not sent in Phase 3 — Resend wires in Phase 10.

  revalidatePath("/admin/tutors");
  revalidatePath("/");
  return { ok: true };
}

export async function rejectTutor(input: {
  tutorId: string;
  note: string;
}): Promise<AdminActionResult> {
  const { user } = await requireRole("admin");
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "A note is required." };
  }

  const [before] = await db
    .select({ status: tutorProfiles.approvalStatus })
    .from(tutorProfiles)
    .where(eq(tutorProfiles.userId, parsed.data.tutorId))
    .limit(1);
  if (!before) return { error: "Tutor not found." };

  await db.transaction(async (tx) => {
    await tx
      .update(tutorProfiles)
      .set({
        approvalStatus: "rejected",
        approvalNote: parsed.data.note,
        approvedAt: null,
      })
      .where(eq(tutorProfiles.userId, parsed.data.tutorId));
    await tx.insert(auditLog).values({
      actorId: user.id,
      action: "tutor.reject",
      targetType: "tutor_profile",
      targetId: parsed.data.tutorId,
      payload: { from: before.status, to: "rejected", note: parsed.data.note },
    });
  });

  // TODO(Phase 10): send the rejection email with the note (SPEC §11).

  revalidatePath("/admin/tutors");
  revalidatePath("/");
  return { ok: true };
}

/**
 * Clear a re-review flag: the admin has looked at the changed profile and is
 * happy. Sets profile_reviewed_at = now(), which makes
 * profile_reviewed_at >= profile_changed_at and drops the row out of the
 * "changed" queue. approval_status is NOT touched — the tutor was never
 * un-approved (SPEC §4.1).
 */
export async function markTutorReviewed(input: {
  tutorId: string;
}): Promise<AdminActionResult> {
  const { user } = await requireRole("admin");
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid tutor." };

  const [before] = await db
    .select({ changedAt: tutorProfiles.profileChangedAt })
    .from(tutorProfiles)
    .where(eq(tutorProfiles.userId, parsed.data.tutorId))
    .limit(1);
  if (!before) return { error: "Tutor not found." };

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(tutorProfiles)
      .set({ profileReviewedAt: now })
      .where(eq(tutorProfiles.userId, parsed.data.tutorId));
    await tx.insert(auditLog).values({
      actorId: user.id,
      action: "tutor.mark_reviewed",
      targetType: "tutor_profile",
      targetId: parsed.data.tutorId,
      payload: { changed_at: before.changedAt?.toISOString() ?? null },
    });
  });

  revalidatePath("/admin/tutors");
  return { ok: true };
}
