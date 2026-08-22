import {
  computeSlots,
  type AvailabilityException,
  type AvailabilityRule,
  type ExistingBooking,
} from "./compute-slots";

/**
 * Server-side slot re-validation (SPEC §5, §7.3). The booking action must never
 * trust that the client sent a genuinely open slot: it re-runs the same pure
 * {@link computeSlots} over freshly loaded rules/exceptions/bookings and checks
 * the requested start is a member. Any reason a slot is not bookable —
 * blocked by an exception, inside the notice cutoff, beyond the horizon, or
 * already taken by another booking — makes it non-member, so re-validation
 * rejects it. Pure and DB-independent, so it is unit-testable (SPEC §15).
 */

/** The one grid granularity shared by the booking UI and this re-validation, so
 *  a start the calendar offered is a start the server recomputes. */
export const SLOT_STEP_MINUTES = 30;

export interface SlotValidationInput {
  rules: AvailabilityRule[];
  exceptions: AvailabilityException[];
  bookings: ExistingBooking[];
  tutorTimeZone: string;
  now: Date;
  minBookingNoticeMinutes: number;
  maxBookingDaysAhead: number;
  durationMinutes: number;
}

/**
 * True iff a booking of `durationMinutes` starting exactly at `startUtc` is
 * bookable given the tutor's availability and the platform cutoffs. The range is
 * anchored in UTC around the requested instant (±1 day) so a slot near a
 * calendar edge is still covered; membership is an exact UTC-instant match.
 */
export function isSlotOpen(
  input: SlotValidationInput,
  startUtc: Date,
): boolean {
  const startMs = startUtc.getTime();
  if (!Number.isFinite(startMs)) return false;

  const day = new Date(startMs);
  const from = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() - 1));
  const to = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + 1));
  const ymd = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

  const slots = computeSlots({
    rules: input.rules,
    exceptions: input.exceptions,
    bookings: input.bookings,
    range: { from: ymd(from), to: ymd(to) },
    tutorTimeZone: input.tutorTimeZone,
    // The date range is anchored in UTC here; membership is by exact instant, so
    // the viewer zone is irrelevant to re-validation.
    viewerTimeZone: "UTC",
    now: input.now,
    minBookingNoticeMinutes: input.minBookingNoticeMinutes,
    maxBookingDaysAhead: input.maxBookingDaysAhead,
    slotDurationMinutes: input.durationMinutes,
    slotStepMinutes: SLOT_STEP_MINUTES,
  });

  return slots.some((s) => s.startUtc.getTime() === startMs);
}
