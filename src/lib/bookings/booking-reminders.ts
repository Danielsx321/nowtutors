import type { ReminderWindow } from "@/db/queries/booking-reminders";

/**
 * The booking-reminders sweep (SPEC §11, §12; Phase 10 Part 3). Every 15
 * minutes: claim the bookings due a 24-hour or a 1-hour reminder (stamping
 * them in the same statement), then send. Behind a port like
 * `release-earnings`, so the rules run in unit tests without Postgres.
 *
 * **Stamp first, send second.** A claimed booking is never claimed again, so a
 * send that fails after its stamp is not retried. That is the best-effort
 * trade SPEC §11 asks for: a missed reminder is better than two, and the
 * booking is on the dashboard either way. Failures are counted in the summary.
 */

export type ReminderKind = "24h" | "1h";

/**
 * 24h: sessions starting 22 to 24 hours from now, booked at least an hour ago.
 * 1h: sessions starting 15 to 60 minutes from now, booked at least 30 minutes
 * ago. Each window is wider than the cadence so one or two missed runs still
 * remind; the stamp stops a second send.
 */
export const REMINDER_WINDOWS: Record<ReminderKind, ReminderWindow> = {
  "24h": { startsAfterMinutes: 22 * 60, startsWithinMinutes: 24 * 60, bookedAtLeastMinutesAgo: 60 },
  "1h": { startsAfterMinutes: 15, startsWithinMinutes: 60, bookedAtLeastMinutesAgo: 30 },
};

export interface BookingRemindersPort {
  claim(kind: ReminderKind, now: Date, window: ReminderWindow): Promise<string[]>;
  /** Send the reminders for one booking. Resolves with how many went out and how many failed. */
  send(kind: ReminderKind, bookingId: string): Promise<{ sent: number; failed: number }>;
}

export interface BookingRemindersResult {
  claimed24hIds: string[];
  claimed1hIds: string[];
  sent: number;
  failed: number;
}

export async function runBookingRemindersSweep(
  port: BookingRemindersPort,
  now: Date = new Date(),
): Promise<BookingRemindersResult> {
  const claimed24hIds = await port.claim("24h", now, REMINDER_WINDOWS["24h"]);
  const claimed1hIds = await port.claim("1h", now, REMINDER_WINDOWS["1h"]);

  let sent = 0;
  let failed = 0;
  const jobs: Array<[ReminderKind, string]> = [
    ...claimed24hIds.map((id) => ["24h", id] as [ReminderKind, string]),
    ...claimed1hIds.map((id) => ["1h", id] as [ReminderKind, string]),
  ];
  for (const [kind, id] of jobs) {
    try {
      const out = await port.send(kind, id);
      sent += out.sent;
      failed += out.failed;
    } catch (err) {
      // One booking's failure must not stop the others: they are already stamped.
      console.error(`[cron/booking-reminders] ${kind} reminder for ${id} failed`, err);
      failed++;
    }
  }
  return { claimed24hIds, claimed1hIds, sent, failed };
}
