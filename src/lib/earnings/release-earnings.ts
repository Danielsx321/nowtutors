import {
  creditWallet,
  DuplicateLedgerReferenceError,
  type LedgerExecutor,
} from "@/lib/credits/ledger";
import type { ClaimedEarning } from "@/db/queries/release-earnings";

/**
 * The `release-earnings` sweep (SPEC §12, §7.11) — the hourly job that turns a
 * `held` promise into spendable credits.
 *
 * **This is the ledger write Phase 6 Part 3C deliberately did not do.**
 * `complete-sessions` writes `tutor_earnings` and touches no wallet, precisely
 * so that this is the only thing in the codebase that credits a tutor for a
 * session. `wallets.credit_balance` means "credits this person can spend or
 * withdraw"; the hold exists to keep those credits unwithdrawable until
 * `available_at`, and crediting earlier would break that number for every other
 * reader of it, `reconcile-wallets` included.
 *
 * **The tutor is credited `net_credits`, and the split is never recomputed
 * here.** `splitEarnings` ran once at completion and its answer is stored on the
 * row (§7.11). Re-deriving it at release would put a second implementation of
 * the fee rule on the path that pays people — and if the platform fee percent
 * ever changes, a recomputation would silently re-price sessions that completed
 * under the old one. A row whose three numbers disagree is **corrupt, not
 * repairable**: it is skipped and counted, never "fixed" (see
 * {@link CorruptSplitError}).
 *
 * Lifted out of the route for the same reason as `complete-sessions`: the money
 * decisions are exercisable without an HTTP handler that pulls in Supabase
 * auth, and — through {@link ReleaseEarningsPort} — without a live Postgres.
 */

/**
 * A row whose stored split does not add up: `net + fee != gross`.
 *
 * **Skipped, counted, and deliberately not repaired.** Nothing here can know
 * *which* of the three numbers is wrong, and every repair is a guess that pays
 * somebody the wrong amount permanently — `credit_transactions` is append-only
 * (§4.4), so a wrong credit cannot be edited away afterwards. Leaving the row
 * `held` keeps it visible, keeps it recoverable by a person who can look at the
 * booking, and pays nobody on a guess.
 */
export class CorruptSplitError extends Error {
  readonly code = "corrupt_split" as const;
  constructor(readonly row: ClaimedEarning) {
    super(
      `tutor_earnings ${row.id}: net ${row.netCredits} + fee ` +
        `${row.platformFeeCredits} != gross ${row.grossCredits}`,
    );
    this.name = "CorruptSplitError";
  }
}

/**
 * The storage this sweep needs, as an interface so the money path is testable
 * against an in-memory {@link LedgerExecutor} without a database — the same
 * adapter seam `lib/credits/ledger.ts` already uses (docs/DECISIONS.md,
 * Phase 4 Part 2). The production implementation is
 * `db/queries/release-earnings.ts`.
 */
export interface ReleaseEarningsPort {
  /** Candidate ids. A work list — the claim itself is below. */
  listDueEarningIds(): Promise<string[]>;
  /**
   * One transaction: atomically claim the row, then run `credit` with an
   * executor bound to that same transaction. `null` when the claim matched
   * nothing. A throw from `credit` must roll the claim back.
   */
  claimAndCreditEarning<T>(
    earningId: string,
    credit: (row: ClaimedEarning, ex: LedgerExecutor) => Promise<T>,
  ): Promise<T | null>;
}

export interface ReleaseEarningsResult {
  /** Earnings ids this run actually claimed AND credited. */
  releasedIds: string[];
  /** Sum of `net_credits` credited by this run. */
  creditsReleased: number;
  /**
   * Listed but the claim matched nothing — an overlapping run got there first,
   * or the row stopped being due between the read and the claim. Expected under
   * concurrency, and the observable form of "exactly once".
   */
  notClaimedIds: string[];
  /** `net + fee != gross`. Left `held`, paid nothing. See {@link CorruptSplitError}. */
  corruptSplitIds: string[];
  /**
   * Claimed, but a `session_earning` for that booking already existed. The
   * `(type, reference_id)` unique index (§4.4) refused the second credit, so the
   * flip rolled back with it and the row is still `held`.
   */
  duplicateLedgerIds: string[];
  /** Anything else that threw. Logged with the id; the batch continues. */
  failedIds: string[];
}

/** `net + fee == gross`, or the row does not get paid. */
function assertSplitConsistent(row: ClaimedEarning): void {
  if (row.netCredits + row.platformFeeCredits !== row.grossCredits) {
    throw new CorruptSplitError(row);
  }
}

export async function runReleaseEarningsSweep(
  port: ReleaseEarningsPort,
): Promise<ReleaseEarningsResult> {
  const releasedIds: string[] = [];
  const notClaimedIds: string[] = [];
  const corruptSplitIds: string[] = [];
  const duplicateLedgerIds: string[] = [];
  const failedIds: string[] = [];
  let creditsReleased = 0;

  for (const earningId of await port.listDueEarningIds()) {
    // Per row, and every failure caught here rather than at the batch: one
    // corrupt row must not cost every other tutor on this run their money.
    try {
      const credited = await port.claimAndCreditEarning(
        earningId,
        async (row, ex) => {
          // Inside the transaction, so a refusal rolls the claim back and the
          // row stays `held`. Checked before the credit for the same reason.
          assertSplitConsistent(row);
          await creditWallet(ex, {
            userId: row.tutorId,
            // net, never gross. The split already happened (§7.11).
            delta: row.netCredits,
            type: "session_earning",
            referenceType: "booking",
            referenceId: row.bookingId,
            description: "Session earnings released",
          });
          return row.netCredits;
        },
      );

      if (credited === null) {
        notClaimedIds.push(earningId);
        continue;
      }
      releasedIds.push(earningId);
      creditsReleased += credited;
    } catch (err) {
      if (err instanceof CorruptSplitError) {
        console.error("[cron/release-earnings] corrupt split", err.message);
        corruptSplitIds.push(earningId);
        continue;
      }
      if (err instanceof DuplicateLedgerReferenceError) {
        // The booking was already paid. The claim rolled back, so the row is
        // still `held` and an operator can see it rather than it being flipped
        // to `available` with no money behind the flip.
        console.error(
          `[cron/release-earnings] ${earningId}: session_earning already exists`,
        );
        duplicateLedgerIds.push(earningId);
        continue;
      }
      console.error(`[cron/release-earnings] ${earningId} failed`, err);
      failedIds.push(earningId);
    }
  }

  return {
    releasedIds,
    creditsReleased,
    notClaimedIds,
    corruptSplitIds,
    duplicateLedgerIds,
    failedIds,
  };
}
