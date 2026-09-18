/**
 * The profile's "This week" strip (live-globe rebuild Part D; pages.html,
 * Tutor profile): seven days from today, each with how many session start
 * times are open, in the viewer's timezone.
 *
 * It reads the same server-computed slots the booking panel offers
 * (`getPublicBookingCalendar`), so a day that says "3 slots" has three times you
 * can actually pick below. Counted on one duration's list (the shortest the
 * tutor offers), because the same start time appears once per duration and
 * summing them would triple-count it.
 */

export interface WeekDay {
  /** YYYY-MM-DD in the viewer's timezone. */
  key: string;
  /** "Mon" */
  weekday: string;
  /** "18" */
  date: string;
  slots: number;
}

export function weekAvailability(isoSlots: readonly string[], timeZone: string, now: Date): WeekDay[] {
  const keyFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const weekdayFmt = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" });
  const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone, day: "numeric" });

  // Seven consecutive calendar days in the viewer's zone. Stepping from noon
  // UTC in 24h hops can land twice on one local day across a DST change, so
  // step by the local key instead and skip repeats.
  const days: WeekDay[] = [];
  const seen = new Set<string>();
  for (let h = 0; days.length < 7 && h < 24 * 9; h += 6) {
    const d = new Date(now.getTime() + h * 3_600_000);
    const key = keyFmt.format(d);
    if (seen.has(key)) continue;
    seen.add(key);
    days.push({ key, weekday: weekdayFmt.format(d), date: dateFmt.format(d), slots: 0 });
  }

  const byKey = new Map(days.map((d) => [d.key, d]));
  for (const iso of new Set(isoSlots)) {
    const day = byKey.get(keyFmt.format(new Date(iso)));
    if (day) day.slots += 1;
  }
  return days;
}

/** The slot list to count: the shortest offered duration's. */
export function slotsForWeek(slotsByDuration: Record<number, string[]>, durations: readonly number[]): string[] {
  const shortest = [...durations].sort((a, b) => a - b)[0];
  return shortest != null ? (slotsByDuration[shortest] ?? []) : [];
}
