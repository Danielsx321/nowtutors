/**
 * `reconcile-wallets` — the drift alarm (SPEC §4.4, §12; Phase 8 Part 3).
 *
 * `wallets.credit_balance` is a cache. The ledger (`credit_transactions`) is the
 * authoritative value, and `lib/credits/ledger.ts` keeps the two equal by
 * writing both in one transaction. This job is the independent check that it
 * actually did: for every user, `credit_balance = sum(delta)`.
 *
 * **It reports and never repairs.** A mismatch means a write path bypassed the
 * ledger or a transaction was only half applied, and nothing here can know
 * which of the two numbers is wrong. The ledger is append-only (§4.4), so a
 * "fix" written by a cron would be a guess made permanent. A person looks.
 *
 * Pure: the database read is `db/queries/reconcile-wallets.ts`, and the route
 * raises the alert. This module only shapes what was found.
 */

export interface WalletDriftRow {
  userId: string;
  /** `null` when the user has ledger rows but no wallet row at all. */
  cachedBalance: number | null;
  ledgerSum: number;
}

export interface WalletMismatch extends WalletDriftRow {
  /** `cachedBalance − ledgerSum`, a missing wallet counting as 0. */
  difference: number;
}

export interface ReconcileSummary {
  walletsChecked: number;
  mismatches: number;
  /** Sum of |difference| across every mismatch. */
  totalAbsoluteDrift: number;
  /** At most {@link MAX_REPORTED_MISMATCHES}, largest drift first. */
  mismatchDetails: WalletMismatch[];
  /** True when more mismatches exist than are listed. */
  truncated: boolean;
}

/** Keeps the cron's JSON response (stored in `net._http_response`) bounded. */
export const MAX_REPORTED_MISMATCHES = 50;

export function summarizeWalletDrift(
  walletsChecked: number,
  rows: WalletDriftRow[],
): ReconcileSummary {
  const mismatches = rows
    .map((r) => ({ ...r, difference: (r.cachedBalance ?? 0) - r.ledgerSum }))
    // The query already filters, but a row that agrees is not a mismatch no
    // matter who produced it.
    .filter((r) => r.difference !== 0)
    .sort(
      (a, b) =>
        Math.abs(b.difference) - Math.abs(a.difference) ||
        a.userId.localeCompare(b.userId),
    );

  return {
    walletsChecked,
    mismatches: mismatches.length,
    totalAbsoluteDrift: mismatches.reduce((n, m) => n + Math.abs(m.difference), 0),
    mismatchDetails: mismatches.slice(0, MAX_REPORTED_MISMATCHES),
    truncated: mismatches.length > MAX_REPORTED_MISMATCHES,
  };
}
