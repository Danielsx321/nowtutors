/**
 * Who may open a direct-pay order for a booking, and what it costs
 * (SPEC §7.3 step 4b, §7.6, §5).
 *
 * Pure and `server-only`-free so the two guarantees that matter are assertable
 * without a database: **a booking belonging to another user is rejected**, and
 * **the price is the one pinned on the booking** (`bookings.price_credits`,
 * written by the server when the slot was taken), never a number from the
 * client. Launch fix M6 (2026-09-26): it used to be re-derived from the
 * tutor's *current* rate, so a rate change inside the 20-minute payment hold
 * charged the student one price while the tutor's earnings were split from
 * another. The instant path always charged its pinned quote; now both do. The
 * route file itself cannot be imported by a test (it pulls in `server-only`
 * transitively), which is why this lives here.
 */

/** The `bookings` + `tutor_profiles` columns the check reads. */
export interface DirectPayBookingRow {
  id: string;
  studentId: string;
  status: string;
  type: string;
  durationMinutes: number | null;
  /** The price pinned on the booking when the slot was taken (M6). Null on a row that predates it. */
  priceCredits: number | null;
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

  // The pinned price, exactly what the booking row says the student agreed to
  // and what the tutor's earnings will be split from (M6).
  const credits = row.priceCredits ?? 0;
  if (credits <= 0) {
    return { ok: false, status: 400, message: "This booking can't be paid for directly." };
  }

  return { ok: true, bookingId: row.id, credits };
}
