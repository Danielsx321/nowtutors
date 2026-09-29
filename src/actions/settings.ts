"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { getSessionProfile, getVerifiedUser, requireUser } from "@/lib/auth/guards";
import {
  accountSettingsSchema,
  changePasswordSchema,
  notificationSettingsSchema,
  type AccountSettingsValues,
  type ChangePasswordValues,
  type NotificationSettingsValues,
} from "@/lib/auth/schemas";
import { readPreferences } from "@/lib/email/preferences";
import { createClient } from "@/lib/supabase/server";

/**
 * The viewer's own settings (SPEC §6 `/dashboard/settings`, `/tutor/settings`;
 * Phase 10 Part 4). Every action acts on the guard's user only: the client
 * sends values, never an id. Not audited: a person's own name, timezone and
 * email preferences are theirs, like the payout email.
 */

export type SettingsResult = { error: string } | { ok: true };

/** The pages that print times or names from `profiles`, so a change shows at once. */
function revalidateSettingsPages() {
  revalidatePath("/dashboard/settings");
  revalidatePath("/tutor/settings");
  revalidatePath("/dashboard", "layout");
  revalidatePath("/tutor", "layout");
}

/**
 * Timezone for everyone; display name for students only. A tutor's name is
 * their public name and is edited on `/tutor/profile`, where the profile
 * re-review rule applies (SPEC §4.1), so a name sent by a tutor is ignored.
 */
export async function updateAccountSettings(input: AccountSettingsValues): Promise<SettingsResult> {
  const user = await requireUser();
  const profile = await getSessionProfile();
  if (!profile?.role) return { error: "Finish setting up your account first." };

  const parsed = accountSettingsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };

  const { displayName, timezone } = parsed.data;
  await db
    .update(profiles)
    .set({
      timezone,
      ...(profile.role === "student" && displayName ? { displayName } : {}),
    })
    .where(eq(profiles.id, user.id));

  revalidateSettingsPages();
  return { ok: true };
}

/**
 * Writes the three switches into `notification_preferences`, keeping any key
 * this form does not own (`marketing`, or anything a later version adds).
 */
export async function updateNotificationSettings(input: NotificationSettingsValues): Promise<SettingsResult> {
  const user = await requireUser();
  const parsed = notificationSettingsSchema.safeParse(input);
  if (!parsed.success) return { error: "Please check the form." };

  const [row] = await db
    .select({ prefs: profiles.notificationPreferences })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);
  if (!row) return { error: "We couldn't find your account." };

  const current = readPreferences(row.prefs);
  await db
    .update(profiles)
    .set({ notificationPreferences: { ...current, ...parsed.data } })
    .where(eq(profiles.id, user.id));

  revalidateSettingsPages();
  return { ok: true };
}

/**
 * Change password: the current one is checked against Supabase before the new
 * one is set, so a borrowed signed-in laptop cannot lock the owner out. An
 * account that signs in with Google only has no password to change.
 */
export async function changePassword(input: ChangePasswordValues): Promise<SettingsResult> {
  await requireUser();
  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };

  const authUser = await getVerifiedUser();
  if (!authUser?.email) return { error: "We couldn't find your account." };
  if (!hasPasswordSignIn(authUser)) {
    return { error: "You sign in with Google, so there's no NowTutors password to change." };
  }

  const supabase = await createClient();
  const check = await supabase.auth.signInWithPassword({
    email: authUser.email,
    password: parsed.data.currentPassword,
  });
  if (check.error) return { error: "Your current password isn't right." };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    console.error("[settings] password update failed", error.message);
    return { error: "We couldn't change your password. Try again in a minute." };
  }
  return { ok: true };
}

/** True when the account has an email-and-password identity (not only Google). */
function hasPasswordSignIn(user: {
  identities?: Array<{ provider: string }> | null;
  app_metadata?: { providers?: string[] } | null;
}): boolean {
  const providers = user.app_metadata?.providers ?? user.identities?.map((i) => i.provider) ?? [];
  return providers.includes("email");
}
