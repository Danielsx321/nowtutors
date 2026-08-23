"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  EmailNotVerifiedError,
  requireRole,
  requireVerifiedEmail,
} from "@/lib/auth/guards";
import { setTutorLive } from "@/db/queries/presence";

export type SetInstantAvailabilityResult =
  | { ok: true; isLive: boolean }
  | { error: string };

const inputSchema = z.object({ live: z.boolean() });

/**
 * The "Available for instant sessions" toggle on `/tutor` (SPEC §7.5).
 *
 * On:  `is_live = true`, `live_mode = 'instant'`, `last_seen_at = now()` — all
 *      three in one statement (§7.5: never write `is_live` true without
 *      `last_seen_at`).
 * Off: `is_live = false`, `live_mode = null`.
 *
 * Authorization, server-side and independent of the layout guard (SPEC §5 Layer
 * 2, CLAUDE.md): `requireRole('tutor')` runs first and enforces role, suspension
 * and — by its default — approval, so an unapproved or suspended tutor cannot
 * advertise themselves as live even by calling this directly. Verified email
 * gates going live exactly as it gates booking (§7.1). The tutor id comes from
 * the guard; the only thing read from the client is the boolean.
 *
 * DELIBERATELY UNRESTRICTED by the tutor's calendar. A scheduled booking does
 * NOT block going live — the scheduled/instant collision is enforced at
 * **accept** (built in Phase 6 Part 2, §7.4), where the actual conflict exists. Checking
 * it here would drop a tutor off the live list for a booking that may never
 * collide with anything, and Bubble has no such check at all.
 */
export async function setInstantAvailability(
  input: { live: boolean },
): Promise<SetInstantAvailabilityResult> {
  let userId: string;
  try {
    const { user } = await requireRole("tutor");
    await requireVerifiedEmail();
    userId = user.id;
  } catch (err) {
    if (err instanceof EmailNotVerifiedError) return { error: err.message };
    throw err; // a redirect (not signed in / wrong role / unapproved) must propagate
  }

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { error: "Could not change your availability." };

  const row = await setTutorLive(userId, parsed.data.live);
  if (!row) return { error: "No tutor profile found for this account." };

  // The live list and the tutor's own dashboard both change.
  revalidatePath("/tutor");
  revalidatePath("/tutors");
  revalidatePath("/");

  return { ok: true, isLive: row.isLive };
}
