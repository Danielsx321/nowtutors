/**
 * Presence staleness — the read-side definition of "live", as a pure function.
 *
 * SPEC §3.1 is emphatic that the `live_tutors` view is the SINGLE definition of
 * stale: no student-facing query reads `is_live` alone, and the sweep cron
 * (§7.5, §12) derives its work set from the view rather than re-deriving a
 * threshold of its own. There is no `presence_stale_seconds` platform setting —
 * a second, tunable definition is exactly the drift this design forecloses.
 *
 * So this module is deliberately NOT a second definition. It is a MIRROR of the
 * view's `last_seen_at > now() - interval '2 minutes'` predicate, existing for
 * two DB-free jobs: unit-testing the boundary (§15) and rendering a "last seen"
 * treatment client-side without a round trip. `tests/unit/presence-staleness.test.ts`
 * parses the interval literal straight out of `drizzle/0014` and asserts it
 * equals {@link PRESENCE_STALE_SECONDS}, so this file cannot drift from the view
 * without a red test.
 */

/** Mirrors `interval '2 minutes'` in the live_tutors view (drizzle/0014). */
export const PRESENCE_STALE_SECONDS = 120;

/**
 * Is `lastSeenAt` fresh enough to count as live at `now`?
 *
 * Boundary matches the view exactly: the predicate is a STRICT `>`, so a
 * heartbeat exactly `PRESENCE_STALE_SECONDS` old is already **stale**. A null
 * `last_seen_at` is never fresh (the drizzle/0003 `tutor_presence_guard` trigger
 * makes `is_live = true` with a null `last_seen_at` impossible in the first
 * place, but the null case is answered here rather than assumed away).
 */
export function isPresenceFresh(
  lastSeenAt: Date | null | undefined,
  now: Date,
): boolean {
  if (!lastSeenAt) return false;
  const ageMs = now.getTime() - lastSeenAt.getTime();
  return ageMs < PRESENCE_STALE_SECONDS * 1000;
}
