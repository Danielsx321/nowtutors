/**
 * Week maths for the availability bonus (SPEC §7.5, §12; availability-bonus,
 * 2026-10-14). Pure, no DB, no timezone library.
 *
 * A bonus week is Monday 00:00:00 UTC to Sunday 23:59:59 UTC. UTC because the
 * app stores UTC, every cron schedule is written in UTC, and the tutors are
 * spread across zones; the tutor page labels the week in the viewer's zone so
 * nobody has to know. Days and weeks are `YYYY-MM-DD` strings, which is what
 * the `date` columns hold and what Postgres compares without a cast.
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

/** `YYYY-MM-DD` of the Monday at or before `d`, in UTC. */
export function weekStartUtc(d: Date): string {
  const dayStart = utcDayStart(utcDayOf(d));
  // getUTCDay: 0 = Sunday. Monday is 0 days back from itself, Sunday is 6 back.
  const back = (dayStart.getUTCDay() + 6) % 7;
  return utcDayOf(new Date(dayStart.getTime() - back * DAY_MS));
}

/** The Monday of the week before the one containing `now`. */
export function previousWeekStartUtc(now: Date): string {
  return utcDayOf(new Date(utcDayStart(weekStartUtc(now)).getTime() - 7 * DAY_MS));
}

/** The seven `YYYY-MM-DD` days of the week that starts on `weekStart`. */
export function weekDaysUtc(weekStart: string): string[] {
  const start = utcDayStart(weekStart).getTime();
  return Array.from({ length: 7 }, (_, i) => utcDayOf(new Date(start + i * DAY_MS)));
}

/** The Sunday that ends the week starting on `weekStart`. */
export function weekEndUtc(weekStart: string): string {
  return weekDaysUtc(weekStart)[6];
}

/**
 * The Mondays of the last `count` complete weeks before the one containing
 * `now`, oldest first. The Monday job awards every one of these it has not
 * awarded yet, so a missed Monday is paid on the next run rather than lost.
 */
export function recentCompleteWeekStarts(now: Date, count: number): string[] {
  const thisWeek = utcDayStart(weekStartUtc(now)).getTime();
  const out: string[] = [];
  for (let i = count; i >= 1; i--) out.push(utcDayOf(new Date(thisWeek - i * 7 * DAY_MS)));
  return out;
}

/** Is `value` a `YYYY-MM-DD` that is a Monday in UTC? */
export function isMondayUtc(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = utcDayStart(value);
  return !Number.isNaN(d.getTime()) && utcDayOf(d) === value && d.getUTCDay() === 1;
}

/**
 * "6 to 12 Oct" or "29 Dec to 4 Jan". The week is a UTC calendar week, so it
 * is labelled with its UTC dates whoever is looking: no instant exists that
 * falls on the same calendar day from UTC-12 to UTC+14, and a label that
 * shifted by a day for some viewers would misstate which days count.
 */
export function formatWeekRange(weekStart: string, locale = "en-GB"): string {
  const start = utcDayStart(weekStart);
  const end = utcDayStart(weekEndUtc(weekStart));
  const timeZone = "UTC";
  const dayMonth = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone });
  const dayOnly = new Intl.DateTimeFormat(locale, { day: "numeric", timeZone });
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  return sameMonth
    ? `${dayOnly.format(start)} to ${dayMonth.format(end)}`
    : `${dayMonth.format(start)} to ${dayMonth.format(end)}`;
}

/** "3h 20m", "45m", "0m". Whole minutes, floor. */
export function formatHours(seconds: number): string {
  const mins = Math.max(0, Math.floor(seconds / 60));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
