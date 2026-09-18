/**
 * Month buckets for the dashboard charts (live-globe rebuild Part E onward):
 * hours learned per month for a student, and in Parts F and G the tutor's
 * hours and earnings and the admin's revenue. Pure, so the bucketing is unit
 * tested and the queries only fetch rows.
 *
 * Months are calendar months in the viewer's timezone, oldest first, ending
 * with the current month, and every month in the range is present (a month
 * with nothing in it is a zero bar, not a missing one).
 */

export interface MonthBucket {
  /** YYYY-MM in the viewer's timezone. */
  key: string;
  /** "Sep" */
  label: string;
  /** Sum of the rows' values (hours, credits...). */
  value: number;
  /** How many rows landed in the month. */
  count: number;
}

function monthKey(d: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  return `${y}-${m}`;
}

/** The last `months` month keys, oldest first, ending with the month `now` is in. */
export function recentMonthKeys(now: Date, timeZone: string, months: number): { key: string; label: string }[] {
  const [y, m] = monthKey(now, timeZone).split("-").map(Number) as [number, number];
  const out: { key: string; label: string }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const total = y * 12 + (m - 1) - i;
    const year = Math.floor(total / 12);
    const month = (total % 12) + 1;
    const key = `${year}-${String(month).padStart(2, "0")}`;
    // Mid-month UTC noon names the month safely in any timezone.
    const label = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(
      new Date(Date.UTC(year, month - 1, 15, 12)),
    );
    out.push({ key, label });
  }
  return out;
}

/**
 * Sum `value` per calendar month in `timeZone`. Rows outside the range are
 * ignored; rows without a date are skipped.
 */
export function bucketByMonth(
  rows: readonly { at: Date | null; value: number }[],
  timeZone: string,
  now: Date,
  months: number,
): MonthBucket[] {
  const buckets = recentMonthKeys(now, timeZone, months).map((m) => ({ ...m, value: 0, count: 0 }));
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  for (const row of rows) {
    if (!row.at) continue;
    const bucket = byKey.get(monthKey(row.at, timeZone));
    if (!bucket) continue;
    bucket.value += row.value;
    bucket.count += 1;
  }
  return buckets;
}

/** 270 minutes → 4.5. One decimal place, since the charts and cards read "4.5 hrs". */
export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10;
}
