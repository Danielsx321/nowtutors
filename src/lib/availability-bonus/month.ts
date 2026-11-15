/**
 * Month maths for the availability bonus (SPEC §7.5, §12; monthly-availability-bonus,
 * 2026-11-15). Pure, no DB, no timezone library.
 *
 * A bonus month is a UTC calendar month: the 1st 00:00:00 UTC to the last day
 * 23:59:59 UTC. UTC because the app stores UTC, every cron schedule is written
 * in UTC, the live-time buckets are UTC days, and the tutors are spread across
 * zones. Days and months are `YYYY-MM-DD` strings, which is what the `date`
 * columns hold and what Postgres compares without a cast; a month is named by
 * its 1st (`YYYY-MM-01`).
 *
 * Replaced `week.ts` when the weekly rule (5 live hours a week, 40 credits)
 * became the monthly one (20 live hours a month, 100 credits, paid after the
 * month ends).
 */

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` of `d` in UTC. */
export function utcDayOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The `Date` at 00:00:00 UTC of a `YYYY-MM-DD` day. */
export function utcDayStart(day: string): Date {
  const [y, m, dd] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd));
}

/** `YYYY-MM-01` of the UTC month containing `d`. */
export function monthStartUtc(d: Date): string {
  return utcDayOf(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
}

/** `YYYY-MM-01` of the month after the one starting `monthStart`. */
export function nextMonthStartUtc(monthStart: string): string {
  const s = utcDayStart(monthStart);
  return utcDayOf(new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 1)));
}

/** The last day (`YYYY-MM-DD`) of the month starting `monthStart`. */
export function monthEndUtc(monthStart: string): string {
  return utcDayOf(new Date(utcDayStart(nextMonthStartUtc(monthStart)).getTime() - DAY_MS));
}

/** Is `value` a real `YYYY-MM-01`? */
export function isMonthStart(value: string): boolean {
  if (!/^\d{4}-\d{2}-01$/.test(value)) return false;
  const d = utcDayStart(value);
  return !Number.isNaN(d.getTime()) && utcDayOf(d) === value;
}

/**
 * The 1sts of the last `count` complete months before the month containing
 * `now`, oldest first, leaving out any month before `floor`. The job awards
 * every one of these it has not awarded yet, so a missed 1st is paid on the
 * next run rather than lost; the floor is what stops a look-back reaching
 * months that were never under the monthly rule.
 */
export function recentCompleteMonthStarts(now: Date, count: number, floor?: string): string[] {
  const current = utcDayStart(monthStartUtc(now));
  const out: string[] = [];
  for (let i = count; i >= 1; i--) {
    const m = utcDayOf(new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - i, 1)));
    if (floor && m < floor) continue;
    out.push(m);
  }
  return out;
}

/** Whole UTC days left in the month containing `now`, today included. */
export function daysLeftInMonth(now: Date): number {
  const today = utcDayStart(utcDayOf(now)).getTime();
  const next = utcDayStart(nextMonthStartUtc(monthStartUtc(now))).getTime();
  return Math.round((next - today) / DAY_MS);
}

/**
 * "November 2026". Labelled in UTC whoever is looking, for the same reason
 * the weekly label was: a month that shifted by a day for some viewers would
 * misstate which days count.
 */
export function formatMonth(monthStart: string, locale = "en-GB"): string {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
    utcDayStart(monthStart),
  );
}

/** "3h 20m", "45m", "0m". Whole minutes, floor. */
export function formatHours(seconds: number): string {
  const mins = Math.max(0, Math.floor(seconds / 60));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
