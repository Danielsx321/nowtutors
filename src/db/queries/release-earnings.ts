import "server-only";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { tutorEarnings } from "@/db/schema";
import { walletExecutor, type LedgerExecutor } from "@/lib/credits/ledger";

/**
 * The `release-earnings` claim (SPEC §12, §7.11).
 *
 * This is where a `held` promise becomes money. `complete-sessions` writes
 * `tutor_earnings` and deliberately touches no wallet (Phase 6 Part 3C); the
 * ledger entry — the thing that *is* the money — is written here, in the same
 * transaction as the status flip.
 *
 * **The claim is an `UPDATE ... RETURNING`, and it is per row.** Three
 * constraints have to hold at once and only one shape satisfies all three:
 *
 *  1. **A row is claimed atomically**, never by a `SELECT` that a second run
 *     could read at the same moment. Under READ COMMITTED a blocked `UPDATE`
 *     re-evaluates its qualifiers against the *updated* row once the lock
 *     clears, so of two overlapping runs the loser sees `status = 'available'`
 *     and matches zero rows. That is the same mechanism the end-session lane
 *     relies on, and no application-side bookkeeping is involved.
 *  2. **The flip and the credit share one transaction**, so neither can exist
 *     without the other.
 *  3. **One transaction per row**, so a corrupt or failing row cannot roll back
 *     another tutor's money.
 *
 * A single batch `UPDATE ... RETURNING` for the whole work set satisfies (1)
 * and breaks (2) and (3): it commits the flips before any wallet is touched, so
 * a crash between them is credits that vanish. Hence {@link listDueEarningIds}
 * (a work list) followed by one {@link claimAndCreditEarning} per id.
 *
 * **The listing read is NOT the claim, and nothing is credited on its
 * authority.** It narrows what to attempt; the `UPDATE` below re-states the
 * full `status = 'held' AND available_at <= now()` predicate and only what that
 * statement returns is ever paid. A stale or duplicated id from the list is
 * therefore a wasted statement, never a second payment.
 */

/** A row this run actually claimed — what the `UPDATE` returned, nothing else. */
export interface ClaimedEarning {
  id: string;
  tutorId: string;
  bookingId: string;
  grossCredits: number;
  platformFeeCredits: number;
  netCredits: number;
}

/**
 * Ids of earnings rows that are due for release.
 *
 * A work list, not a claim — see the note above. `available_at` is nullable
 * (`drizzle/0000`), and `NULL <= now()` is NULL rather than true, so a row with
 * no release date is never listed and never claimed. That is the fail-safe
 * direction: a missing release date must not release immediately.
 *
 * Ordered oldest-first so a batch that is interrupted has released the longest
 * waiting rows, and so two runs walk the same order rather than meeting
 * head-on.
 */
export async function listDueEarningIds(): Promise<string[]> {
  const rows = await db
    .select({ id: tutorEarnings.id })
    .from(tutorEarnings)
    .where(
      and(
        eq(tutorEarnings.status, "held"),
        lte(tutorEarnings.availableAt, sql`now()`),
      ),
    )
    .orderBy(asc(tutorEarnings.availableAt));
  return rows.map((r) => r.id);
}

/**
 * Claim one earnings row and credit the tutor, or do neither.
 *
 * In ONE transaction: flip `held` → `available`, then hand `credit` a
 * {@link LedgerExecutor} bound to that same transaction. If `credit` throws,
 * the flip is rolled back with it and the row is still `held` — recoverable on
 * the next run, which is the only safe direction. A flip that committed without
 * its ledger entry would be credits that silently vanish.
 *
 * Returns `null` when the `UPDATE` matched nothing: another overlapping run
 * claimed the row first, or it is no longer due. That is an ordinary outcome,
 * not an error — it is what winning-exactly-once looks like from the losing
 * side.
 *
 * `updated_at` is not set here: `drizzle/0003` attaches a `set_updated_at`
 * BEFORE UPDATE trigger to every table that has the column.
 */
export async function claimAndCreditEarning<T>(
  earningId: string,
  credit: (row: ClaimedEarning, ex: LedgerExecutor) => Promise<T>,
): Promise<T | null> {
  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(tutorEarnings)
      .set({ status: "available" })
      .where(
        and(
          eq(tutorEarnings.id, earningId),
          // Both qualifiers restated deliberately. This — not the listing read
          // — is what makes the claim exactly-once, and dropping either one
          // here would pay a row twice or pay one before it is due.
          eq(tutorEarnings.status, "held"),
          lte(tutorEarnings.availableAt, sql`now()`),
        ),
      )
      .returning({
        id: tutorEarnings.id,
        tutorId: tutorEarnings.tutorId,
        bookingId: tutorEarnings.bookingId,
        grossCredits: tutorEarnings.grossCredits,
        platformFeeCredits: tutorEarnings.platformFeeCredits,
        netCredits: tutorEarnings.netCredits,
      });

    if (!claimed) return null;
    return credit(claimed, walletExecutor(tx));
  });
}
