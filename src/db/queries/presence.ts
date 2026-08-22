import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { profiles, tutorProfiles } from "@/db/schema";

/**
 * Presence writes (SPEC §7.5). Every function here takes an already-authorized
 * user id from the caller's session — none of them accept a client-supplied id,
 * and none of them are reachable without a guard running first.
 *
 * The read side is not here: live status is derived from the `live_tutors` view
 * (§3.1) by `db/queries/tutors.ts` and friends, never from `is_live`.
 */

/**
 * Heartbeat target. Bumps `profiles.last_seen_at`, and for a tutor also
 * `tutor_profiles.last_seen_at` — the column the `live_tutors` view filters on.
 *
 * Deliberately does NOT touch `is_live`: a heartbeat says "this tab is open",
 * not "make me live". Going live is its own explicit action.
 */
export async function touchPresence(
  userId: string,
  role: "student" | "tutor" | "admin" | null,
): Promise<{ tutorTouched: boolean }> {
  await db
    .update(profiles)
    .set({ lastSeenAt: new Date() })
    .where(eq(profiles.id, userId));

  if (role !== "tutor") return { tutorTouched: false };

  const touched = await db
    .update(tutorProfiles)
    .set({ lastSeenAt: new Date() })
    .where(eq(tutorProfiles.userId, userId))
    .returning({ userId: tutorProfiles.userId });

  return { tutorTouched: touched.length > 0 };
}

/**
 * Go live / go offline for instant sessions (SPEC §7.5).
 *
 * Going live always writes `last_seen_at` in the same statement — SPEC §7.5's
 * "never write `is_live = true` without also writing `last_seen_at`". The
 * drizzle/0003 `tutor_presence_guard` trigger is the DB backstop, not the plan.
 *
 * UNRESTRICTED with respect to the tutor's calendar: a scheduled booking does
 * not block going live. That collision is enforced at **accept** (Phase 6 Part
 * 2, SPEC §7.4) — blocking here would take a tutor off the live list for a
 * booking they may well finish before anyone requests them.
 *
 * `live = false` here is the ONLY path that clears `is_live` immediately, and it
 * only ever runs from the tutor's own deliberate toggle-off. Nothing clears
 * presence on page unload: `pagehide` cannot tell a reload from an exit, so the
 * beacon that used to do it was removed (docs/DECISIONS.md). An ungraceful exit
 * is answered by the `live_tutors` view at read time (§3.1) and tidied by the
 * sweep — neither of which can mistake a refresh for a departure.
 */
export async function setTutorLive(
  userId: string,
  live: boolean,
): Promise<{ isLive: boolean; liveMode: "instant" | "broadcast" | null } | null> {
  const [row] = await db
    .update(tutorProfiles)
    .set(
      live
        ? { isLive: true, liveMode: "instant", lastSeenAt: new Date() }
        : { isLive: false, liveMode: null },
    )
    .where(eq(tutorProfiles.userId, userId))
    .returning({
      isLive: tutorProfiles.isLive,
      liveMode: tutorProfiles.liveMode,
    });
  return row ?? null;
}

/** Current toggle state for the tutor's own dashboard. */
export async function getTutorLiveState(
  userId: string,
): Promise<{ isLive: boolean; lastSeenAt: Date | null } | null> {
  const [row] = await db
    .select({
      isLive: tutorProfiles.isLive,
      lastSeenAt: tutorProfiles.lastSeenAt,
    })
    .from(tutorProfiles)
    .where(eq(tutorProfiles.userId, userId))
    .limit(1);
  return row ?? null;
}

/**
 * The staleness sweep (SPEC §7.5 defence 2, §12 `sweep-presence`).
 *
 * The work set is **derived from the `live_tutors` view**, not from a threshold
 * this function knows: any row still flagged `is_live` that the view does not
 * return is, by definition, no longer live. That keeps §3.1's "the view is the
 * single definition of stale" literally true — there is no second copy of the
 * 2-minute interval anywhere in the write path, and no `presence_stale_seconds`
 * setting to disagree with it.
 *
 * A consequence worth naming: the view also requires `approval_status =
 * 'approved'`, so a tutor whose approval was revoked while live is swept offline
 * too. That is the correct outcome — an unapproved tutor must not be advertised
 * as live — and the go-live action refuses unapproved tutors anyway, so this is
 * a backstop rather than a routine path.
 *
 * Idempotent: the predicate stops matching the rows it just cleared, so a second
 * run in the same window updates nothing.
 */
export async function sweepStalePresence(): Promise<{ sweptUserIds: string[] }> {
  const swept = await db
    .update(tutorProfiles)
    .set({ isLive: false, liveMode: null })
    .where(
      and(
        eq(tutorProfiles.isLive, true),
        sql`not exists (select 1 from public.live_tutors lt where lt.user_id = ${tutorProfiles.userId})`,
      ),
    )
    .returning({ userId: tutorProfiles.userId });

  return { sweptUserIds: swept.map((r) => r.userId) };
}
