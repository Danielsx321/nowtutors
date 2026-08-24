import "server-only";
import {
  endElapsedInstantSession,
  findElapsedInstantSessionIds,
  sweepElapsedScheduledSessions,
  sweepInstantNoShows,
  type SweptBooking,
} from "@/db/queries/complete-sessions";
import { insertHeldEarnings, type HeldEarning } from "@/db/queries/earnings";
import { splitEarnings } from "@/lib/credits/fees";
import { statusEarnsPayout } from "./completion";
import { getEarningsSettings } from "@/lib/settings";

/**
 * The `complete-sessions` sweep itself (SPEC §12, §7.11, §7.4).
 *
 * Lifted out of `app/api/cron/complete-sessions/route.ts` so the route stays
 * what the other two crons are — a guard, a call, a structured log — and so the
 * money decisions here can be exercised against a real Postgres without going
 * through an HTTP handler that pulls in Supabase auth. The route adds nothing to
 * this beyond the bearer check and the JSON envelope.
 *
 * THIS FUNCTION DOES NOT TOUCH A WALLET. No `creditWallet`, no
 * `credit_transactions` row; nothing in `lib/credits/ledger.ts` is imported on
 * this path, transitively or otherwise. A `held` earnings row is a promise, and
 * the ledger entry that turns it into money is written when `release-earnings`
 * flips `held` → `available` (Phase 8). Crediting `wallets.credit_balance` at
 * completion would put credits a tutor cannot withdraw yet into the number that
 * means "credits you can spend or withdraw".
 */

export interface CompleteSessionsResult {
  completedIds: string[];
  noShowTutorIds: string[];
  noShowStudentIds: string[];
  /** Booking ids that actually got a row — what the database did, not intent. */
  earningsCreatedIds: string[];
}

export async function runCompleteSessionsSweep(): Promise<CompleteSessionsResult> {
  const { platformFeePercent, earningsHoldHours } = await getEarningsSettings();

  const swept: SweptBooking[] = [];

  // 1. Instant sessions that started and whose booked duration has run out.
  //
  // Read the ids, then close each through the **shipped**
  // `endElapsedInstantSession`. Not a bulk UPDATE written here: that statement
  // carries the `ended_at` cap and the `status = 'in_progress'` exactly-once
  // guard, and a copy of it would be a second place for the rule that decides a
  // tutor's withdrawal date to live. Sequential, because the rows are
  // independent and a 15-minute cadence has no throughput problem.
  //
  // A null result is not an error: a participant closing the room between the
  // read and the write is exactly what the guard is for, and their transition is
  // the one that stands. The row is simply not this run's to count.
  for (const bookingId of await findElapsedInstantSessionIds()) {
    const ended = await endElapsedInstantSession(bookingId);
    if (!ended) continue;
    swept.push({
      bookingId: ended.bookingId,
      tutorId: ended.tutorId,
      studentId: ended.studentId,
      // The only status that statement writes; it refuses everything else.
      status: "completed",
      priceCredits: ended.priceCredits,
      endedAt: ended.endedAt,
    });
  }

  // 2. Instant sessions whose booked window passed with the pair never meeting,
  //    and 3. scheduled sessions past their end plus the 30-minute grace. Both
  //    classify from `started_at` / `*_joined_at` through the same fragment.
  swept.push(...(await sweepInstantNoShows()));
  swept.push(...(await sweepElapsedScheduledSessions()));

  const earnings: HeldEarning[] = swept
    .filter((row) => statusEarnsPayout(row.status))
    .map((row) => {
      // `price_credits` is written on every booking at creation, by both the
      // accept transaction and the scheduled booking action. The coalesce is for
      // a row that predates that and would otherwise violate the NOT NULL on
      // `gross_credits` — a zero-credit promise, not a skipped one, so the
      // booking still gets its single permitted earnings row.
      const gross = row.priceCredits ?? 0;
      const split = splitEarnings(gross, platformFeePercent);
      // Every sweep above sets `ended_at` in the same statement that sets the
      // status, so this fallback does not fire. It exists because a null
      // `available_at` would be silently invisible to Phase 8's release sweep.
      const endedAt = row.endedAt ?? new Date();
      return {
        bookingId: row.bookingId,
        tutorId: row.tutorId,
        grossCredits: split.grossCredits,
        platformFeeCredits: split.platformFeeCredits,
        netCredits: split.netCredits,
        availableAt: new Date(
          endedAt.getTime() + earningsHoldHours * 60 * 60 * 1000,
        ),
      };
    });

  const earningsCreatedIds = await insertHeldEarnings(earnings);
  const idsWith = (status: string) =>
    swept.filter((row) => row.status === status).map((row) => row.bookingId);

  return {
    completedIds: idsWith("completed"),
    noShowTutorIds: idsWith("no_show_tutor"),
    noShowStudentIds: idsWith("no_show_student"),
    earningsCreatedIds,
  };
}
