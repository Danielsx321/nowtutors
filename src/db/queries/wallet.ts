import "server-only";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { creditTransactions, payments, wallets } from "@/db/schema";
import type { CreditTransactionType } from "@/lib/credits/ledger";
import {
  retainedCreditMints,
  walletDescription,
  type RetainedMint,
  type WalletRow,
} from "@/lib/credits/retained-credits";

/**
 * Wallet reads for `/dashboard/wallet` (SPEC §6, §7.10, §4.4).
 *
 * The balance is the cached `wallets.credit_balance`; the authoritative value is
 * the ledger sum, which a nightly job reconciles (§4.4) — this page shows the
 * cache, like every other read path.
 *
 * History is **paginated, never loaded whole**: `credit_transactions` is
 * append-only and grows without bound, so the page reads one window ordered by
 * the existing `(user_id, created_at desc)` index (`credit_tx_user_created_idx`).
 *
 * One description is **derived here rather than stored**: the retained-credit
 * mint of a direct-pay whose booking could not be confirmed (§7.6). The stored
 * row keeps its ordinary purchase wording forever, because §4.4's append-only
 * rule admits no UPDATE path at all — see `lib/credits/retained-credits.ts`.
 */

/** History rows per page. */
export const WALLET_PAGE_SIZE = 20;

export interface WalletTransaction {
  id: string;
  /** Signed: positive credits added, negative removed. Never zero (§4.4 check). */
  delta: number;
  balanceAfter: number;
  type: CreditTransactionType;
  /**
   * What the student reads. Normally `credit_transactions.description` verbatim;
   * for a retained-credit mint it is derived on this read (§7.6). This is a
   * **view** of the row, not the row — the stored description is never rewritten.
   */
  description: string | null;
  createdAt: Date;
}

export interface WalletHistoryPage {
  transactions: WalletTransaction[];
  /** 1-based. */
  page: number;
  pageCount: number;
  total: number;
}

/** The user's cached credit balance (0 when no wallet row exists yet). */
export async function getWalletBalanceFor(userId: string): Promise<number> {
  const [row] = await db
    .select({ balance: wallets.creditBalance })
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);
  return row?.balance ?? 0;
}

/**
 * One page of the user's ledger, newest first. `page` is 1-based and clamped
 * into range, so a hand-typed `?page=999` renders the last page rather than an
 * empty table.
 */
export async function getWalletHistory(
  userId: string,
  page = 1,
  pageSize = WALLET_PAGE_SIZE,
): Promise<WalletHistoryPage> {
  const [{ total }] = await db
    .select({ total: count() })
    .from(creditTransactions)
    .where(eq(creditTransactions.userId, userId));

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, Math.trunc(page) || 1), pageCount);

  const rows = await db
    .select({
      id: creditTransactions.id,
      delta: creditTransactions.delta,
      balanceAfter: creditTransactions.balanceAfter,
      type: creditTransactions.type,
      referenceId: creditTransactions.referenceId,
      description: creditTransactions.description,
      createdAt: creditTransactions.createdAt,
    })
    .from(creditTransactions)
    .where(eq(creditTransactions.userId, userId))
    // Matches credit_tx_user_created_idx (user_id, created_at desc) exactly.
    .orderBy(desc(creditTransactions.createdAt))
    .limit(pageSize)
    .offset((current - 1) * pageSize);

  const retained = await retainedMintsOn(rows);

  return {
    transactions: rows.map(({ referenceId, ...t }) => ({
      ...t,
      description: walletDescription({ ...t, referenceId }, retained),
    })),
    page: current,
    pageCount,
    total,
  };
}

/**
 * The two reads behind {@link retainedCreditMints}, scoped to **one page** of
 * history — never the whole ledger. Both are keyed lookups on existing indexes
 * (`payments` by primary key, `credit_transactions` by the
 * `(type, reference_id)` unique index), and both are skipped entirely when the
 * page holds no `purchase` rows, which most pages don't.
 *
 * The decision itself lives in `lib/credits/retained-credits.ts`, pure and
 * unit-tested; this function only fetches what it needs.
 */
async function retainedMintsOn(
  rows: readonly WalletRow[],
): Promise<Map<string, RetainedMint>> {
  const empty = new Map<string, RetainedMint>();

  // Every `purchase` row references a payment. Which of those are direct-pay is
  // what the next query decides — nothing is assumed from the ledger row alone.
  const paymentIds = [
    ...new Set(
      rows
        .filter((r) => r.type === "purchase" && r.referenceId)
        .map((r) => r.referenceId!),
    ),
  ];
  if (paymentIds.length === 0) return empty;

  const paid = await db
    .select({
      id: payments.id,
      purpose: payments.purpose,
      bookingId: payments.bookingId,
      amountUsd: payments.amountUsd,
      currency: payments.currency,
    })
    .from(payments)
    .where(inArray(payments.id, paymentIds));

  const bookingIds = paid
    .filter((p) => p.purpose === "booking" && p.bookingId)
    .map((p) => p.bookingId!);
  if (bookingIds.length === 0) return empty;

  // A `booking_debit` for the booking means the spend landed — the student got
  // the session, so nothing was retained.
  const debits = await db
    .select({ referenceId: creditTransactions.referenceId })
    .from(creditTransactions)
    .where(
      and(
        eq(creditTransactions.type, "booking_debit"),
        inArray(creditTransactions.referenceId, bookingIds),
      ),
    );

  return retainedCreditMints(
    paid,
    new Set(debits.map((d) => d.referenceId!).filter(Boolean)),
  );
}
