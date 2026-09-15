import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";

/**
 * What the authenticated shell shows about the viewer: the name under the
 * avatar and the initials in it.
 *
 * Its own query because the shell renders on every authenticated page and has
 * no business pulling a whole profile for two fields. The topbar showed
 * "Guest" to signed-in people until the design overhaul, which is what this
 * fixes.
 */
export async function getShellIdentity(
  userId: string,
): Promise<{ displayName: string | null; avatarUrl: string | null }> {
  const [row] = await db
    .select({ displayName: profiles.displayName, avatarUrl: profiles.avatarUrl })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  return { displayName: row?.displayName ?? null, avatarUrl: row?.avatarUrl ?? null };
}
