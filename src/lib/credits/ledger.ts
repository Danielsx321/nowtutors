import { and, eq, sql } from "drizzle-orm";
import { creditTransactions, wallets } from "@/db/schema";
import type { DbTransaction } from "@/db";
import type { creditTransactionType } from "@/db/schema/enums";

/**
 * The ONLY writer to `wallets.credit_balance` and `credit_transactions`
 * (SPEC §7.10, CLAUDE.md). Every credit/debit runs inside a caller-provided
 * transaction, takes a `SELECT ... FOR UPDATE` row lock on the wallet, rejects a
 * debit that would go negative, appends one append-only ledger row, and updates
 * the cached balance — all or nothing.
 *
 * Testability (docs/DECISIONS.md, Phase 4 Part 2): the two functions operate on
 * a small `LedgerExecutor` interface rather than the Drizzle transaction
 * directly, so the money invariants — insufficient-balance rejection, correct
 * `balance_after`, idempotency on a duplicate reference, and no lost update under
 * a serialized lock — are unit-testable against an in-memory executor without a
 * live Postgres (which the pooler + CI don't provide). `walletExecutor(tx)` is
 * the production adapter; it is the single place that issues the wallet UPDATE.
 */

export type CreditTransactionType =
  (typeof creditTransactionType.enumValues)[number];

/** Raised when a debit (or negative credit) would drop the balance below zero. */
export class InsufficientCreditsError extends Error {
  readonly code = "insufficient_credits" as const;
  constructor(
    readonly available: number,
    readonly requested: number,
  ) {
    super("Insufficient credit balance for this operation.");
    this.name = "InsufficientCreditsError";
  }
}

/**
 * Raised when the append hits the `(type, reference_id)` idempotency guard
 * (SPEC §4.4) — the same logical transaction was already recorded. Callers that
 * retry (e.g. a replayed webhook, Phase 5) treat this as a no-op success.
 */
export class DuplicateLedgerReferenceError extends Error {
  readonly code = "duplicate_reference" as const;
  constructor(
    readonly type: CreditTransactionType,
    readonly referenceId: string,
  ) {
    super("A ledger entry for this reference already exists.");
    this.name = "DuplicateLedgerReferenceError";
  }
}

export interface LedgerRow {
  userId: string;
  delta: number;
  balanceAfter: number;
  type: CreditTransactionType;
  referenceType?: string | null;
  referenceId?: string | null;
  description?: string | null;
  createdBy?: string | null;
}

/**
 * The minimal storage surface the ledger needs. The production adapter wraps a
 * Drizzle transaction; tests provide an in-memory implementation that models the
 * row lock and the unique index.
 */
export interface LedgerExecutor {
  /** Lock (`FOR UPDATE`) and read the wallet balance; null when no wallet row. */
  lockWallet(userId: string): Promise<number | null>;
  /** Create a zero-balance wallet row (used by a credit into a fresh account). */
  createWallet(userId: string): Promise<void>;
  /** Append one ledger row; throws DuplicateLedgerReferenceError on ref conflict. */
  insertTransaction(row: LedgerRow): Promise<void>;
  /** Overwrite the cached balance for an existing wallet row. */
  setBalance(userId: string, balance: number): Promise<void>;
  /**
   * Rewrite the `description` of an already-appended row, keyed on the same
   * `(type, reference_id)` pair the unique index uses. See
   * {@link describeTransaction} for why this does not break append-only.
   */
  setDescription(
    type: CreditTransactionType,
    referenceId: string,
    description: string,
  ): Promise<void>;
}

interface CreditParams {
  userId: string;
  /** Signed. Positive adds credits; negative (e.g. admin adjustment) removes. */
  delta: number;
  type: CreditTransactionType;
  referenceType?: string | null;
  referenceId?: string | null;
  description?: string | null;
  createdBy?: string | null;
}

interface DebitParams {
  userId: string;
  /** Positive amount to remove. */
  amount: number;
  type: CreditTransactionType;
  referenceType?: string | null;
  referenceId?: string | null;
  description?: string | null;
  createdBy?: string | null;
}

/** Shared core: lock, apply a signed delta, reject negatives, append, update. */
async function applyDelta(
  ex: LedgerExecutor,
  p: {
    userId: string;
    delta: number;
    type: CreditTransactionType;
    referenceType?: string | null;
    referenceId?: string | null;
    description?: string | null;
    createdBy?: string | null;
  },
): Promise<{ balanceAfter: number }> {
  if (!Number.isInteger(p.delta) || p.delta === 0) {
    throw new Error("Ledger delta must be a non-zero integer.");
  }

  let current = await ex.lockWallet(p.userId);
  if (current === null) {
    // No wallet yet. A debit against nothing is simply insufficient; a credit
    // opens the account at zero first (then the update below lands the balance).
    if (p.delta < 0) throw new InsufficientCreditsError(0, -p.delta);
    await ex.createWallet(p.userId);
    current = 0;
  }

  const balanceAfter = current + p.delta;
  if (balanceAfter < 0) {
    throw new InsufficientCreditsError(current, -p.delta);
  }

  // Append first: the (type, reference_id) unique index is the idempotency guard,
  // so a duplicate is rejected before the cached balance moves.
  await ex.insertTransaction({
    userId: p.userId,
    delta: p.delta,
    balanceAfter,
    type: p.type,
    referenceType: p.referenceType ?? null,
    referenceId: p.referenceId ?? null,
    description: p.description ?? null,
    createdBy: p.createdBy ?? null,
  });
  await ex.setBalance(p.userId, balanceAfter);
  return { balanceAfter };
}

/** Add (or, with a negative delta, remove) credits. SPEC §7.10. */
export function creditWallet(
  ex: LedgerExecutor,
  p: CreditParams,
): Promise<{ balanceAfter: number }> {
  return applyDelta(ex, { ...p, delta: p.delta });
}

/** Remove `amount` credits, rejecting any debit that would go negative. */
export function debitWallet(
  ex: LedgerExecutor,
  p: DebitParams,
): Promise<{ balanceAfter: number }> {
  if (!Number.isInteger(p.amount) || p.amount <= 0) {
    throw new Error("Debit amount must be a positive integer.");
  }
  const { amount, ...rest } = p;
  return applyDelta(ex, { ...rest, delta: -amount });
}

/**
 * Amend the human-readable `description` of a row already in the ledger.
 *
 * **This does not break append-only.** Append-only is about the money: no
 * delta, no `balance_after`, and no row is ever created, changed or removed
 * here — only the sentence the student reads on `/dashboard/wallet`. It exists
 * for exactly one caller: PayPal direct-pay settlement, which mints credits
 * *before* it learns whether the booking can still be confirmed (SPEC §7.6), so
 * the mint's description can only be made truthful after the fact. Keyed on
 * `(type, reference_id)` — the same pair the unique index keys on — so it
 * addresses precisely one row.
 */
export function describeTransaction(
  ex: LedgerExecutor,
  p: {
    type: CreditTransactionType;
    referenceId: string;
    description: string;
  },
): Promise<void> {
  return ex.setDescription(p.type, p.referenceId, p.description);
}

/** Postgres unique-violation SQLSTATE (the idempotency-guard conflict). */
const UNIQUE_VIOLATION = "23505";

/**
 * The Postgres SQLSTATE for an error, unwrapping Drizzle's `DrizzleQueryError`
 * (which carries the real driver error on `.cause`). Returns undefined for a
 * non-database error.
 */
export function pgErrorCode(err: unknown): string | undefined {
  let e: unknown = err;
  for (let depth = 0; depth < 5 && e; depth++) {
    if (typeof e === "object" && e !== null) {
      const code = (e as { code?: unknown }).code;
      if (typeof code === "string") return code;
      e = (e as { cause?: unknown }).cause;
    } else {
      break;
    }
  }
  return undefined;
}

/**
 * Production {@link LedgerExecutor} over a Drizzle transaction. This is the one
 * place in the codebase that issues the `wallets.credit_balance` UPDATE.
 */
export function walletExecutor(t: DbTransaction): LedgerExecutor {
  return {
    async lockWallet(userId) {
      const [row] = await t
        .select({ creditBalance: wallets.creditBalance })
        .from(wallets)
        .where(eq(wallets.userId, userId))
        .for("update")
        .limit(1);
      return row ? row.creditBalance : null;
    },
    async createWallet(userId) {
      await t
        .insert(wallets)
        .values({ userId, creditBalance: 0 })
        .onConflictDoNothing({ target: wallets.userId });
    },
    async insertTransaction(row) {
      try {
        await t.insert(creditTransactions).values({
          userId: row.userId,
          delta: row.delta,
          balanceAfter: row.balanceAfter,
          type: row.type,
          referenceType: row.referenceType ?? null,
          referenceId: row.referenceId ?? null,
          description: row.description ?? null,
          createdBy: row.createdBy ?? null,
        });
      } catch (err) {
        if (pgErrorCode(err) === UNIQUE_VIOLATION) {
          throw new DuplicateLedgerReferenceError(
            row.type,
            String(row.referenceId),
          );
        }
        throw err;
      }
    },
    async setBalance(userId, balance) {
      await t
        .update(wallets)
        .set({ creditBalance: balance, updatedAt: sql`now()` })
        .where(eq(wallets.userId, userId));
    },
    async setDescription(type, referenceId, description) {
      await t
        .update(creditTransactions)
        .set({ description })
        .where(
          and(
            eq(creditTransactions.type, type),
            eq(creditTransactions.referenceId, referenceId),
          ),
        );
    },
  };
}
