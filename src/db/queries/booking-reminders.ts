import "server-only";
import { and, eq, gt, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { bookings } from "@/db/schema";
import type { ReminderKind } from "@/lib/bookings/booking-reminders";

/**
 * Claim the bookings due a reminder, stamp-first (SPEC §12, booking-reminders).
 *
 * One `UPDATE ... RETURNING` per kind: the stamp is written in the same
 * statement that selects the row, and the `IS NULL` predicate is re-checked
 * under the row lock Postgres takes for the update, so two overlapping runs
 * can never both claim a booking. What is returned is what this run owns.
 *
 * The windows (see `REMINDER_WINDOWS`) are wider than the 15-minute cadence so
 * a missed run or two still reminds; the `created_at` floor stops a booking
 * made inside the window from getting a "your session is coming up" email
 * minutes after its confirmation.
 */
export async function claimDueReminders(kind: ReminderKind, now: Date, window: ReminderWindow): Promise<string[]> {
  const stamp = kind === "24h" ? bookings.reminder24hSentAt : bookings.reminder1hSentAt;
  const set = kind === "24h" ? { reminder24hSentAt: now } : { reminder1hSentAt: now };
  const rows = await db
    .update(bookings)
    .set(set)
    .where(
      and(
        eq(bookings.type, "scheduled"),
        eq(bookings.status, "confirmed"),
        isNull(stamp),
        gt(bookings.scheduledStartAt, new Date(now.getTime() + window.startsAfterMinutes * 60_000)),
        lte(bookings.scheduledStartAt, new Date(now.getTime() + window.startsWithinMinutes * 60_000)),
        lte(bookings.createdAt, new Date(now.getTime() - window.bookedAtLeastMinutesAgo * 60_000)),
      ),
    )
    .returning({ id: bookings.id });
  return rows.map((r) => r.id);
}

export interface ReminderWindow {
  /** The session starts later than now + this. */
  startsAfterMinutes: number;
  /** ...and no later than now + this. */
  startsWithinMinutes: number;
  /** The booking was made at least this long ago. */
  bookedAtLeastMinutesAgo: number;
}
