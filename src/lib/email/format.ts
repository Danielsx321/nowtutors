/**
 * Plain-text fragments for email bodies. `lib/dashboard/when.ts` formats
 * times relative to now ("Tomorrow, 6:00 PM"), which reads well on a page that
 * refreshes and badly in an email opened three days later. Emails print the
 * full date, the time and the zone every time.
 */

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** "Thu 2 Oct 2026, 4:30 PM (GMT+1)". Falls back to UTC on a bad zone. */
export function absoluteWhen(at: Date, timeZone: string | null | undefined): string {
  const tz = timeZone && isValidTimeZone(timeZone) ? timeZone : "UTC";
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: tz,
    timeZoneName: "short",
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const dayPeriod = get("dayPeriod").toUpperCase();
  return `${get("weekday")} ${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")} ${dayPeriod} (${get("timeZoneName")})`;
}

export function creditsLine(n: number): string {
  return `${n} ${n === 1 ? "credit" : "credits"}`;
}

/** `"30.66"` to `"$30.66"`. The column is USD text already rounded to the cent. */
export function usdLine(amountUsd: string): string {
  return `$${amountUsd}`;
}

/** The first word of a name, for greetings; "there" when nothing is known. */
export function firstNameOf(fullName: string | null | undefined, displayName?: string | null): string {
  const source = (displayName ?? fullName ?? "").trim();
  const first = source.split(/\s+/)[0];
  return first || "there";
}

/** "algebra-ii" to "Algebra ii": enough for an admin alert, no lookup needed. */
export function slugToWords(slug: string): string {
  const words = slug.replace(/[-_]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : slug;
}
