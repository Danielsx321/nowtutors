/**
 * How the dashboards say when a session starts (Part E; pages.html session
 * cards): short and relative for the pill ("Now", "In 25 min", "In 2 hrs",
 * "Tomorrow", "Sat", "12 Oct"), and full for the line under the tutor
 * ("Today, 6:00 PM", "Thu, 4:30 PM", "Mon 12 Oct, 9:00 AM"), both in the
 * viewer's timezone.
 */

const DAY = 86_400_000;

function dayKey(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Whole calendar days from `now` to `at` in the viewer's zone (0 today, 1 tomorrow). */
export function calendarDaysBetween(now: Date, at: Date, timeZone: string): number {
  const a = new Date(`${dayKey(now, timeZone)}T00:00:00Z`).getTime();
  const b = new Date(`${dayKey(at, timeZone)}T00:00:00Z`).getTime();
  return Math.round((b - a) / DAY);
}

export function relativeWhen(at: Date, now: Date, timeZone: string, inProgress = false): string {
  if (inProgress) return "Now";
  const ms = at.getTime() - now.getTime();
  if (ms <= 0) return "Now";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `In ${mins} min`;
  const days = calendarDaysBetween(now, at, timeZone);
  if (days === 0) {
    const hrs = Math.round(mins / 60);
    return `In ${hrs} ${hrs === 1 ? "hr" : "hrs"}`;
  }
  if (days === 1) return "Tomorrow";
  if (days < 7) return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(at);
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short" }).format(at);
}

export function fullWhen(at: Date, now: Date, timeZone: string): string {
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(at);
  const days = calendarDaysBetween(now, at, timeZone);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Tomorrow, ${time}`;
  if (days > 1 && days < 7) {
    return `${new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(at)}, ${time}`;
  }
  const date = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short" }).format(at);
  return `${date}, ${time}`;
}

/**
 * How full the countdown bar under a session card is: empty a week out, full
 * at the start. A session further away than a week shows a sliver, not
 * nothing, so the bar still reads as a bar.
 */
export function countdownFraction(at: Date, now: Date, horizonDays = 7): number {
  const left = at.getTime() - now.getTime();
  if (left <= 0) return 1;
  return Math.min(1, Math.max(0.04, 1 - left / (horizonDays * DAY)));
}

/** "10 min ago", "3 hrs ago", "yesterday", "4 days ago", then the date. For queues and activity lists. */
export function timeAgo(at: Date, now: Date, timeZone: string): string {
  const mins = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const days = -calendarDaysBetween(now, at, timeZone);
  if (days === 0) {
    const hrs = Math.round(mins / 60);
    return `${hrs} ${hrs === 1 ? "hr" : "hrs"} ago`;
  }
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short" }).format(at);
}
