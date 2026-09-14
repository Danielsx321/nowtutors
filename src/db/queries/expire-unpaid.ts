import "server-only";
import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { bookings } from "@/db/schema";
import { PENDING_PAYMENT_HOLD_MINUTES } from "@/lib/availability/compute-slots";

/**
 * `expire-unpaid` (SPEC §4.2, §12; Phase 8 Part 3): `pending_payment` bookings
 * whose checkout window has passed become `expired`.
 *
 * **Tidy-up, not correctness.** `computeSlots` already stops treating a stale
 * hold as occupying on read, and the booking transaction expires any stale hold
 * its slot collides with on write, so nothing double-sells without this job. It
 * clears the rows no later booking happened to collide with, so the student's
 * list and an operator's view stop saying "awaiting payment" forever.
 *
 * **Same window and same boundary as the read side.** `PENDING_PAYMENT_HOLD_MINUTES`
 * is the one constant, and a hold stops blocking when `created_at + hold <= now`
 * (`computeSlots`), so this uses `created_at <= now() - hold`: a row this job
 * expires is always one the calendar had already released. The database clock
 * is used, the one `created_at` was written against.
 *
 * **Safe against a late PayPal capture.** If a buyer approves after the row is
 * expired, settlement's confirm finds no `pending_payment` row, skips the debit,
 * and the student keeps the minted credits (`booking_unavailable_credits_retained`,
 * §7.6). They lose the slot, never the money.
 *
 * Not restricted to `type = 'scheduled'`: only direct-pay creates
 * `pending_payment` today and that is scheduled-only, but the rule is about the
 * status, not the booking type.
 *
 * Idempotent: an expired row no longer matches, so a double-fire returns
 * nothing. `updated_at` is set by the `set_updated_at` trigger (`drizzle/0003`).
 */
export async function expireUnpaidBookings(): Promise<{ expiredIds: string[] }> {
  const rows = await db
    .update(bookings)
    .set({ status: "expired" })
    .where(
      and(
        eq(bookings.status, "pending_payment"),
        lte(
          bookings.createdAt,
          sql`now() - make_interval(mins => ${PENDING_PAYMENT_HOLD_MINUTES})`,
        ),
      ),
    )
    .returning({ id: bookings.id });
  return { expiredIds: rows.map((r) => r.id) };
}
