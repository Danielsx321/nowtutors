import { sessionPriceCredits } from "@/lib/credits/pricing";

/**
 * Who may open a direct-pay order for a booking, and what it costs
 * (SPEC §7.3 step 4b, §7.6, §5).
 *
 * Pure and `server-only`-free so the two guarantees that matter are assertable
 * without a database: **a booking belonging to another user is rejected**, and
 * **the price is re-derived server-side** from the tutor's current rate and the
 * booking's duration — never read from the booking row, and never from the
 * client. The route file itself cannot be imported by a test (it pulls in
 * `server-only` transitively), which is why this lives here.
 */

/** The `bookings` + `tutor_profiles` columns the check reads. */
export interface DirectPayBookingRow {
  id: string;
  studentId: string;
  status: string;
  type: string;
  durationMinutes: number | null;
  /** The tutor's CURRENT rate, not whatever the booking was priced at. */
  hourlyRateCredits: number;
}

export type DirectPayEligibility =
  | { ok: true; bookingId: string; credits: number }
  | { ok: false; status: number; message: string };

/**
 * Decide whether `userId` may pay for this booking, and re-derive the price.
 *
 * A booking that does not exist and one belonging to someone else return the
 * **same** 404, so the endpoint cannot be used to probe booking ids — the same
 * choice the capture route makes for `payments` (docs/DECISIONS.md, Part 1).
 */
export function checkDirectPayEligibility(
  row: DirectPayBookingRow | null | undefined,
  userId: string,
): DirectPayEligibility {
  if (!row || row.studentId !== userId) {
    return { ok: false, status: 404, message: "Booking not found." };
  }
  if (row.status !== "pending_payment") {
    return { ok: false, status: 409, message: "This booking isn't awaiting payment." };
  }
  if (row.type !== "scheduled" || !row.durationMinutes) {
    return { ok: false, status: 400, message: "This booking can't be paid for directly." };
  }

  // The one pricing formula, re-run server-side. `bookings.price_credits` is
  // deliberately NOT trusted here either: it is a snapshot, and the tutor's
  // current rate is what the student is being asked to pay.
  const credits = sessionPriceCredits(row.hourlyRateCredits, row.durationMinutes);
  if (credits <= 0) {
    return { ok: false, status: 400, message: "This booking can't be paid for directly." };
  }

  return { ok: true, bookingId: row.id, credits };
}
