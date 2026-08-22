/**
 * Pure, DB-independent bookable-slot computation (SPEC §4.2, §7.3).
 *
 * Takes plain data in — availability rules, one-off exceptions, existing
 * bookings, a date range, the tutor's and viewer's time zones, and the two
 * platform cutoffs — and returns bookable slots as UTC instants, ready for the
 * caller to render in the viewer's time zone. There is **no database access
 * here**: the query layer loads the rows and hands them in, so every branch
 * below is unit-testable without a connection (SPEC §15).
 *
 * Model (see docs/DECISIONS.md, Phase 4 Part 1):
 *  - A *slot* is a discrete candidate start time on a fixed grid. A slot is
 *    bookable iff the half-open interval `[start, start + duration)` lies
 *    entirely inside an availability window for that tutor-local day, overlaps
 *    no existing booking, starts at or after `now + minBookingNoticeMinutes`,
 *    and starts at or before `now + maxBookingDaysAhead` days.
 *  - Rules are stored in the **tutor's** time zone (weekday + wall-clock time)
 *    and expanded per tutor-local calendar date, then converted to UTC — so a
 *    DST transition in the tutor's zone shifts the UTC instant of "9am" without
 *    moving the wall clock the tutor configured.
 *  - The requested date range is a pair of inclusive calendar dates read in the
 *    **viewer's** time zone (the student browses their own calendar, §7.3).
 *  - Time-zone conversion uses the runtime's IANA database via `Intl`
 *    (ICU) — no extra dependency, and DST-correct — rather than @date-fns/tz.
 */

/** A recurring weekly availability window, in the tutor's local time. */
export interface AvailabilityRule {
  /** 0 = Sunday .. 6 = Saturday (matches `availability_rules.weekday`). */
  weekday: number;
  /** Tutor-local wall-clock start, "HH:MM" or "HH:MM:SS". */
  startTime: string;
  /** Tutor-local wall-clock end, "HH:MM" or "HH:MM:SS". `end > start`. */
  endTime: string;
  /** Inactive rules are ignored. Defaults to true when omitted. */
  isActive?: boolean;
}

/** A one-off override for a single tutor-local calendar date. */
export interface AvailabilityException {
  /** Tutor-local calendar date, "YYYY-MM-DD". */
  date: string;
  /**
   * `false` blocks the whole day (any times ignored). `true` with both times
   * set is a partial-day override window that *replaces* the day's rules.
   * `true` with null times is a no-op (the day's rules still apply).
   */
  isAvailable: boolean;
  startTime?: string | null;
  endTime?: string | null;
}

/**
 * An existing booking that occupies the tutor, as UTC instants. Overlap is
 * checked half-open, so a booking ending exactly when another would start does
 * not collide.
 *
 * Callers pass bookings that hold the slot — scheduled, status `confirmed` or
 * `in_progress` (SPEC §4.3) — **plus** `pending_payment` bookings, which hold
 * the slot only while their checkout is still live (see
 * {@link PENDING_PAYMENT_HOLD_MINUTES}). A row with no `status` always blocks,
 * so a caller that hasn't been taught about pending payments keeps its old
 * meaning.
 */
export interface ExistingBooking {
  startAt: Date | string;
  endAt: Date | string;
  /** `bookings.status`. Omitted means "occupies unconditionally". */
  status?: string | null;
  /** `bookings.created_at`. Required for a `pending_payment` row to be aged. */
  createdAt?: Date | string | null;
}

/**
 * How long an unpaid `pending_payment` booking holds its slot (SPEC §7.3 —
 * "a 20-minute expiry", §4.2).
 *
 * After this, an abandoned PayPal checkout stops blocking the slot **on read**:
 * `computeSlots` ages the row by its own `created_at` rather than waiting for
 * anything to rewrite it. The §12 expire-unpaid cron is therefore **tidy-up,
 * not correctness** — exactly the relationship `live_tutors` has with
 * sweep-presence (§3.1), where the view derives liveness from a timestamp and
 * the sweep merely tidies the flag. A student who abandons checkout does not
 * strand the tutor's calendar until a cron happens to run.
 */
export const PENDING_PAYMENT_HOLD_MINUTES = 20;

/** Inclusive calendar-date range, read in the viewer's time zone. */
export interface DateRange {
  /** "YYYY-MM-DD" */
  from: string;
  /** "YYYY-MM-DD", inclusive */
  to: string;
}

export interface ComputeSlotsInput {
  rules: AvailabilityRule[];
  exceptions: AvailabilityException[];
  bookings: ExistingBooking[];
  range: DateRange;
  /** IANA zone the rules/exceptions are written in, e.g. "America/New_York". */
  tutorTimeZone: string;
  /** IANA zone the `range` dates are read in and slots will be rendered in. */
  viewerTimeZone: string;
  /** Reference "now" as a UTC instant. Explicit so the cutoffs are testable. */
  now: Date | string;
  /** Hard cutoff: slots starting sooner than this many minutes are excluded. */
  minBookingNoticeMinutes: number;
  /** Hard cutoff: slots starting further than this many days ahead are excluded. */
  maxBookingDaysAhead: number;
  /** Intended booking length. The booking flow calls once per offered duration. */
  slotDurationMinutes?: number;
  /** Grid granularity for candidate starts, from each window's start. */
  slotStepMinutes?: number;
  /**
   * How long a `pending_payment` booking holds its slot, from its `created_at`.
   * Defaults to {@link PENDING_PAYMENT_HOLD_MINUTES}.
   */
  pendingPaymentHoldMinutes?: number;
}

/** A bookable slot as UTC instants. Render `startUtc` in the viewer's zone. */
export interface Slot {
  startUtc: Date;
  endUtc: Date;
}

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
const DEFAULT_DURATION_MINUTES = 60;
const DEFAULT_STEP_MINUTES = 30;

/** Wall-clock components of an instant as observed in an IANA time zone. */
export interface ZonedWallClock {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  second: number; // 0-59
}

/**
 * The wall-clock time an instant reads as in `timeZone`. Exported so callers
 * (and tests) can render a UTC slot in the viewer's zone without re-deriving
 * `Intl` plumbing.
 */
export function wallClockInZone(instant: Date, timeZone: string): ZonedWallClock {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  // Some ICU builds emit hour "24" for midnight under h23; normalize to 0.
  const hour = Number(map.hour) % 24;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** Offset in ms (zone wall-clock minus UTC) that `timeZone` had at `instant`. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const w = wallClockInZone(instant, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - instant.getTime();
}

/**
 * The UTC instant for a wall-clock time in `timeZone`. DST-correct: the offset
 * is measured at the target instant, then refined once to settle the case where
 * the naive guess and the true instant straddle a transition. Nonexistent
 * spring-forward times resolve forward; ambiguous fall-back times resolve to the
 * first (pre-transition) occurrence — acceptable for availability windows.
 */
export function zonedWallToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const offset = zoneOffsetMs(new Date(naive), timeZone);
  let utc = naive - offset;
  const refined = zoneOffsetMs(new Date(utc), timeZone);
  if (refined !== offset) utc = naive - refined;
  return new Date(utc);
}

/** Minutes past midnight for "HH:MM" / "HH:MM:SS". */
function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":");
  return Number(h) * 60 + Number(m);
}

/** "YYYY-MM-DD" → its three integer parts. */
function parseYmd(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

function toYmd(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** 0=Sun..6=Sat for a calendar date (weekday is time-zone independent). */
function weekdayOf(date: string): number {
  const { year, month, day } = parseYmd(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Calendar date `days` after `date` (may be negative), as "YYYY-MM-DD". */
function addDays(date: string, days: number): string {
  const { year, month, day } = parseYmd(date);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return toYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

interface Window {
  startMinute: number;
  endMinute: number;
}

/**
 * Availability windows (tutor-local minutes) for one tutor-local date, after
 * applying exceptions over the recurring rules. Empty = nothing bookable.
 */
function windowsForDate(
  date: string,
  rules: AvailabilityRule[],
  exceptions: AvailabilityException[],
): Window[] {
  const onThisDate = exceptions.filter((e) => e.date === date);

  // Any full-day block wins outright.
  if (onThisDate.some((e) => !e.isAvailable)) return [];

  // A partial-day override (available + both times) replaces the day's rules.
  const overrides = onThisDate.filter(
    (e) => e.isAvailable && e.startTime != null && e.endTime != null,
  );
  if (overrides.length > 0) {
    return overrides.map((e) => ({
      startMinute: parseTimeToMinutes(e.startTime as string),
      endMinute: parseTimeToMinutes(e.endTime as string),
    }));
  }

  const weekday = weekdayOf(date);
  return rules
    .filter((r) => (r.isActive ?? true) && r.weekday === weekday)
    .map((r) => ({
      startMinute: parseTimeToMinutes(r.startTime),
      endMinute: parseTimeToMinutes(r.endTime),
    }));
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Half-open overlap: [aStart, aEnd) intersects [bStart, bEnd). */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Compute bookable slots for the given inputs. Pure: same inputs → same output,
 * no I/O. Returns slots sorted ascending by start, de-duplicated.
 */
export function computeSlots(input: ComputeSlotsInput): Slot[] {
  const duration = input.slotDurationMinutes ?? DEFAULT_DURATION_MINUTES;
  const step = input.slotStepMinutes ?? DEFAULT_STEP_MINUTES;
  if (duration <= 0 || step <= 0) return [];

  const now = toDate(input.now).getTime();
  // Cutoffs are both inclusive: a slot exactly `notice` minutes out is bookable,
  // and one exactly `maxDays` out is bookable (docs/DECISIONS.md, Phase 4 Part 1).
  const earliestStart = now + input.minBookingNoticeMinutes * MS_PER_MINUTE;
  const latestStart = now + input.maxBookingDaysAhead * MS_PER_DAY;

  // Range window in UTC, from the viewer-local midnights of the inclusive dates.
  // `rangeStartUtc` is inclusive; `rangeEndUtc` is the day-after midnight, exclusive.
  const from = parseYmd(input.range.from);
  const toExclusive = parseYmd(addDays(input.range.to, 1));
  const rangeStartUtc = zonedWallToUtc(
    from.year,
    from.month,
    from.day,
    0,
    0,
    input.viewerTimeZone,
  ).getTime();
  const rangeEndUtc = zonedWallToUtc(
    toExclusive.year,
    toExclusive.month,
    toExclusive.day,
    0,
    0,
    input.viewerTimeZone,
  ).getTime();
  if (rangeEndUtc <= rangeStartUtc) return [];

  // Which tutor-local dates can contribute? Pad a day each side of the range so
  // a viewer-tz range edge that lands mid-day in the tutor's zone is covered.
  const firstTutorDate = wallClockInZone(new Date(rangeStartUtc), input.tutorTimeZone);
  const lastTutorDate = wallClockInZone(new Date(rangeEndUtc), input.tutorTimeZone);
  const startDate = addDays(toYmd(firstTutorDate.year, firstTutorDate.month, firstTutorDate.day), -1);
  const endDate = addDays(toYmd(lastTutorDate.year, lastTutorDate.month, lastTutorDate.day), 1);

  // A pending_payment booking holds its slot only while its checkout is live.
  // Past the hold window it is an abandoned checkout and stops blocking on
  // read — the cron that expires the row is tidy-up, not correctness (§4.2).
  const holdMs =
    (input.pendingPaymentHoldMinutes ?? PENDING_PAYMENT_HOLD_MINUTES) * MS_PER_MINUTE;
  const bookings = input.bookings
    .filter((b) => {
      if (b.status !== "pending_payment") return true;
      // No created_at means we cannot age it; fail safe and keep blocking.
      if (b.createdAt == null) return true;
      return toDate(b.createdAt).getTime() + holdMs > now;
    })
    .map((b) => ({
      start: toDate(b.startAt).getTime(),
      end: toDate(b.endAt).getTime(),
    }));

  const durationMs = duration * MS_PER_MINUTE;
  const seen = new Set<number>();
  const slots: Slot[] = [];

  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    const windows = windowsForDate(date, input.rules, input.exceptions);
    const { year, month, day } = parseYmd(date);

    for (const w of windows) {
      // Candidate starts step from the window's own start; the whole booking
      // must fit before the window ends.
      for (
        let startMin = w.startMinute;
        startMin + duration <= w.endMinute;
        startMin += step
      ) {
        const hour = Math.floor(startMin / 60);
        const minute = startMin % 60;
        const startUtc = zonedWallToUtc(year, month, day, hour, minute, input.tutorTimeZone);
        const startMs = startUtc.getTime();
        const endMs = startMs + durationMs;

        if (startMs < rangeStartUtc || startMs >= rangeEndUtc) continue; // requested range
        if (startMs < earliestStart) continue; // min booking notice
        if (startMs > latestStart) continue; // max booking horizon
        if (bookings.some((b) => overlaps(startMs, endMs, b.start, b.end))) continue;
        if (seen.has(startMs)) continue;

        seen.add(startMs);
        slots.push({ startUtc, endUtc: new Date(endMs) });
      }
    }
  }

  slots.sort((a, b) => a.startUtc.getTime() - b.startUtc.getTime());
  return slots;
}
