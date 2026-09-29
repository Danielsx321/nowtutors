import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import type { Recipient } from "./types";

const columns = {
  id: profiles.id,
  email: profiles.email,
  fullName: profiles.fullName,
  displayName: profiles.displayName,
  timezone: profiles.timezone,
  notificationPreferences: profiles.notificationPreferences,
};

/**
 * Who an email goes to. `profiles.email` is written once by the
 * `handle_new_user` trigger at signup (drizzle/0002) and is the address every
 * admin screen shows, so it is the address emails use too. A tutor's PayPal
 * address is a different thing (`tutor_payout_details`) and is never a
 * recipient.
 */
export async function getRecipient(userId: string): Promise<Recipient | null> {
  const [row] = await db.select(columns).from(profiles).where(eq(profiles.id, userId)).limit(1);
  return row ?? null;
}

/** Every admin who is not suspended. The admin alerts go to all of them. */
export async function getAdminRecipients(): Promise<Recipient[]> {
  return db
    .select(columns)
    .from(profiles)
    .where(and(eq(profiles.role, "admin"), eq(profiles.isSuspended, false)));
}
