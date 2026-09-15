"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { requireRole } from "@/lib/auth/guards";
import {
  applyCreditAdjustment,
  applyPromotion,
  applySuspension,
} from "@/db/queries/admin-users";
import {
  adjustmentSchema,
  promotionBlockerMessage,
  selfSuspensionRefused,
} from "@/lib/admin/users";

/**
 * `/admin/users` actions (SPEC §5, §6, §7.10; Phase 8 Part 5).
 *
 * `requireRole('admin')` is the FIRST statement of each, before any input is
 * read or any row is touched (the layout guard is only a redirect, §5 Layer 2).
 * The actor always comes from the guard; the target user id is a legitimate
 * client input (an admin acting on someone else) and is validated as a uuid.
 */

export type AdminUserActionResult = { ok: true; message: string } | { error: string };

function revalidateUser(userId: string) {
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin");
  revalidatePath("/admin/audit");
}

const suspendSchema = z.object({ userId: z.string().uuid(), suspended: z.boolean() });

export async function setUserSuspended(input: {
  userId: string;
  suspended: boolean;
}): Promise<AdminUserActionResult> {
  const { user } = await requireRole("admin");
  const parsed = suspendSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid user." };
  const { userId, suspended } = parsed.data;
  if (suspended && selfSuspensionRefused(user.id, userId)) {
    return { error: "You can't suspend your own account." };
  }

  const res = await db.transaction((tx) =>
    applySuspension(tx, { userId, suspended, actorId: user.id }),
  );
  if (!res.ok) return { error: "User not found." };

  revalidateUser(userId);
  // Browse and tutor profiles hide suspended tutors.
  revalidatePath("/", "layout");
  if (!res.changed) {
    return { ok: true, message: suspended ? "Already suspended." : "Already active." };
  }
  return {
    ok: true,
    message: suspended
      ? `Account suspended${res.wentOffline ? " and taken offline" : ""}.`
      : "Account unsuspended.",
  };
}

export async function adjustUserCredits(input: {
  userId: string;
  delta: number;
  note: string;
  requestKey: string;
}): Promise<AdminUserActionResult> {
  const { user } = await requireRole("admin");
  const parsed = adjustmentSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid adjustment." };
  }
  const { userId, delta, note, requestKey } = parsed.data;

  const res = await db.transaction((tx) =>
    applyCreditAdjustment(tx, { userId, delta, note, requestKey, actorId: user.id }),
  );
  if (!res.ok) {
    if (res.reason === "insufficient") {
      return {
        error: `That would take the balance below zero. Current balance: ${res.available} credits.`,
      };
    }
    if (res.reason === "role") {
      return { error: "Only student and tutor wallets can be adjusted." };
    }
    return { error: "User not found." };
  }

  revalidateUser(userId);
  if (res.duplicate) return { ok: true, message: "This adjustment was already applied." };
  return { ok: true, message: `Done. New balance: ${res.balanceAfter} credits.` };
}

const promoteSchema = z.object({
  userId: z.string().uuid(),
  confirmEmail: z.string().max(320),
});

export async function promoteToAdmin(input: {
  userId: string;
  confirmEmail: string;
}): Promise<AdminUserActionResult> {
  const { user } = await requireRole("admin");
  const parsed = promoteSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid user." };
  const { userId, confirmEmail } = parsed.data;

  const res = await db.transaction((tx) =>
    applyPromotion(tx, { userId, confirmEmail, actorId: user.id }),
  );
  if (!res.ok) return { error: res.blockers.map(promotionBlockerMessage).join(" ") };

  revalidateUser(userId);
  return { ok: true, message: "Promoted to admin." };
}
