/**
 * The §12 jobs that exist as routes under `app/api/cron/*` (Phase 8 Part 4).
 *
 * Pure (no DB, no env) so the admin UI and a unit test can import it. The test
 * pins this list to the route directories, so a new cron cannot ship without a
 * "run now" button, and a button cannot point at a job that doesn't exist.
 */
export const CRON_JOB_NAMES = [
  "sweep-presence",
  "expire-requests",
  "expire-unpaid",
  "complete-sessions",
  "release-earnings",
  "reconcile-wallets",
] as const;

export type CronJobName = (typeof CRON_JOB_NAMES)[number];

export function isCronJobName(value: unknown): value is CronJobName {
  return typeof value === "string" && (CRON_JOB_NAMES as readonly string[]).includes(value);
}

/** Schedule and a plain description, for `/admin/settings`. */
export const CRON_JOB_INFO: Record<CronJobName, { schedule: string; what: string }> = {
  "sweep-presence": {
    schedule: "Every 5 minutes",
    what: "Takes stale tutors offline, ends broadcasts whose host has gone, expires their pending requests and wakes the Agora token service.",
  },
  "expire-requests": {
    schedule: "Every minute",
    what: "Marks instant requests past their deadline as expired.",
  },
  "expire-unpaid": {
    schedule: "Every 10 minutes",
    what: "Marks abandoned direct-pay checkouts as expired.",
  },
  "complete-sessions": {
    schedule: "Every 15 minutes",
    what: "Closes finished sessions, classifies no-shows and writes held earnings.",
  },
  "release-earnings": {
    schedule: "Hourly",
    what: "Moves held earnings past their hold into tutors' wallets.",
  },
  "reconcile-wallets": {
    schedule: "Daily at 03:00 UTC",
    what: "Checks every wallet against its ledger. Reports drift, never repairs it.",
  },
};
