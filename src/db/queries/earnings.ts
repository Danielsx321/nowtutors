import "server-only";
import { db } from "@/db";
import { tutorEarnings } from "@/db/schema";

/**
 * Writing `tutor_earnings` (SPEC §7.11).
 *
 * **A `held` earnings row is a promise, not money.** Nothing here touches a
 * wallet: no `creditWallet`, no `credit_transactions` entry, nothing from
 * `lib/credits/ledger.ts` is imported by this module or by its caller. The
 * ledger entry is written when `release-earnings` flips `held` → `available`
 * (Phase 8), because `wallets.credit_balance` means "credits this person can
 * spend or withdraw" — crediting it at completion would put credits there that
 * the hold deliberately makes unwithdrawable, and break what that number means
 * for every other reader of it.
 */

/** One row to write. `available_at` is already `ended_at + hold` (§7.11). */
export interface HeldEarning {
  bookingId: string;
  tutorId: string;
  grossCredits: number;
  platformFeeCredits: number;
  netCredits: number;
  availableAt: Date;
}

/**
 * Insert held earnings, at most one per booking, ever.
 *
 * **`tutor_earnings.booking_id` is UNIQUE (`drizzle/0000`), and this uses it.**
 * `ON CONFLICT DO NOTHING` on that constraint is what makes a double-fire, a
 * retry after a timeout, or two overlapping cron runs unable to double-pay — the
 * database refuses the second write rather than the application remembering not
 * to make it. The status predicates upstream already stop matching a row they
 * have classified; this is the guarantee that does not depend on them, because
 * the window between the transition committing and this insert running is real.
 *
 * Returns the booking ids actually inserted, so the handler's `earningsCreated`
 * count is what the database did rather than what the caller intended. On a
 * second run that number is zero, which is the observable form of the promise.
 *
 * A single statement for the whole batch: the rows are independent and a partial
 * failure has no meaning worth preserving, so there is nothing here for a
 * transaction to protect.
 */
export async function insertHeldEarnings(
  rows: HeldEarning[],
): Promise<string[]> {
  if (rows.length === 0) return [];
  const inserted = await db
    .insert(tutorEarnings)
    .values(
      rows.map((r) => ({
        bookingId: r.bookingId,
        tutorId: r.tutorId,
        grossCredits: r.grossCredits,
        platformFeeCredits: r.platformFeeCredits,
        netCredits: r.netCredits,
        // The column defaults to `held`; stated anyway, because "which status a
        // completion writes" is a §7.11 rule and not a schema detail.
        status: "held" as const,
        availableAt: r.availableAt,
      })),
    )
    .onConflictDoNothing({ target: tutorEarnings.bookingId })
    .returning({ bookingId: tutorEarnings.bookingId });
  return inserted.map((r) => r.bookingId);
}
