import { PRESENCE_STALE_SECONDS } from "@/lib/presence/staleness";

/**
 * How many seconds a heartbeat adds to a live tutor's day bucket (SPEC §7.5;
 * availability-bonus, 2026-10-14). Pure.
 *
 * The heartbeat fires every 30 seconds while the tab is visible and overwrites
 * `last_seen_at`. The gap between the previous beat and this one is the time
 * the tutor was live, with one cap: a gap longer than the presence staleness
 * window means the tutor was NOT live during it (the `live_tutors` view had
 * already hidden them, and the sweep had taken them offline), so only the
 * window itself is credited. This is what stops a hidden tab, a shut laptop
 * or a dropped connection counting as hours.
 *
 * The cap is `PRESENCE_STALE_SECONDS` and not a second constant, so the two
 * cannot drift: the view's interval is pinned by `presence-staleness.test.ts`.
 */
export const ACCRUAL_CAP_SECONDS = PRESENCE_STALE_SECONDS;

export function secondsToAccrue(
  prevLastSeenAt: Date | null | undefined,
  now: Date,
  capSeconds: number = ACCRUAL_CAP_SECONDS,
): number {
  if (!prevLastSeenAt) return 0;
  const gap = Math.floor((now.getTime() - prevLastSeenAt.getTime()) / 1000);
  if (!Number.isFinite(gap) || gap <= 0) return 0;
  return Math.min(gap, capSeconds);
}
