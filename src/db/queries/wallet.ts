import "server-only";
import { count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { creditTransactions, wallets } from "@/db/schema";
import type { CreditTransactionType } from "@/lib/credits/ledger";

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
 */

/** History rows per page. */
export const WALLET_PAGE_SIZE = 20;

export interface WalletTransaction {
  id: string;
  /** Signed: positive credits added, negative removed. Never zero (§4.4 check). */
  delta: number;
  balanceAfter: number;
  type: CreditTransactionType;
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
      description: creditTransactions.description,
      createdAt: creditTransactions.createdAt,
    })
    .from(creditTransactions)
    .where(eq(creditTransactions.userId, userId))
    // Matches credit_tx_user_created_idx (user_id, created_at desc) exactly.
    .orderBy(desc(creditTransactions.createdAt))
    .limit(pageSize)
    .offset((current - 1) * pageSize);

  return { transactions: rows, page: current, pageCount, total };
}
