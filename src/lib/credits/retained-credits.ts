import type { CreditTransactionType } from "./ledger";

/**
 * The **retained-credit mint**, derived at read time (SPEC §4.4, §7.6).
 *
 * When a direct-pay capture is honoured but its booking can no longer be
 * confirmed, settlement mints the credits and skips the debit: the student
 * keeps the money as credits. That mint lands on `/dashboard/wallet` carrying a
 * **positive** balance they really hold, so it must not read like a session
 * they paid for and cannot find.
 *
 * It would be easy to rewrite that row's `description` once the confirm fails.
 * We deliberately do not. `credit_transactions` is append-only — never updated,
 * never deleted (§4.4) — and the whole value of that rule is that it is
 * **absolute**: an append-only table with one narrow UPDATE path is a table
 * where every future reader has to ask which rows were rewritten. So the mint
 * is inserted once, with the ordinary purchase description, and never touched
 * again; the retained-credit wording is *computed* here, at read time, from
 * facts already in the database.
 *
 * A `purchase` row is a retained-credit mint iff **all** of:
 *
 *  1. `type = 'purchase'`;
 *  2. the `payments` row it references (`reference_id`) has `purpose = 'booking'`
 *     — a plain credit purchase is never retained, it is simply bought; and
 *  3. **no** `booking_debit` row exists for that payment's `booking_id`.
 *
 * (3) is the load-bearing one, and it is a fact rather than an inference: the
 * debit is written iff the confirm succeeded, in the same transaction, so its
 * absence *is* the record that the booking was never confirmed. `/admin/payments`
 * derives its own flag the same way, which is why the two agree.
 *
 * Pure and DB-free, so the derivation is unit-testable without a live Postgres
 * (which the pooler + CI don't provide) — the same split the ledger and
 * settlement use. `db/queries/wallet.ts` supplies the two reads.
 */

/** The `payments` columns the derivation needs. */
export interface RetainedMintPayment {
  id: string;
  purpose: string;
  bookingId: string | null;
  amountUsd: string;
  currency: string;
}

/** What the wording needs, once a payment is known to be a retained mint. */
export interface RetainedMint {
  amountUsd: string;
  currency: string;
}

/** The ledger columns the derivation reads. Never mutated — this is a read. */
export interface WalletRow {
  type: CreditTransactionType;
  delta: number;
  referenceId: string | null;
  description: string | null;
}

/**
 * Which of `payments` are retained-credit mints, keyed by `payments.id` (the
 * `reference_id` their `purchase` row carries).
 *
 * `debitedBookingIds` is every `booking_id` that already has a `booking_debit`
 * row — a completed direct-pay. Those are excluded: their credits were spent on
 * the session the student actually got.
 */
export function retainedCreditMints(
  payments: readonly RetainedMintPayment[],
  debitedBookingIds: ReadonlySet<string>,
): Map<string, RetainedMint> {
  const retained = new Map<string, RetainedMint>();
  for (const p of payments) {
    if (p.purpose !== "booking") continue; // an ordinary credit purchase
    if (!p.bookingId) continue; // nothing was ever booked to lose
    if (debitedBookingIds.has(p.bookingId)) continue; // the session happened
    retained.set(p.id, { amountUsd: p.amountUsd, currency: p.currency });
  }
  return retained;
}

/**
 * Wallet-history wording for a retained-credit mint. It has to explain itself
 * unprompted: why they were credited, and that the credits are theirs to spend.
 * `credits` is the row's own `delta` — the credits actually in the wallet.
 */
export function retainedCreditsDescription(
  credits: number,
  amountUsd: string,
  currency: string,
): string {
  return (
    `${credits} credits added — that session slot was no longer available, so ` +
    `your $${amountUsd} ${currency} payment was kept as credits. They are ` +
    `yours to spend on a new booking.`
  );
}

/**
 * What the student reads for one ledger row: the retained-credit wording when
 * the derivation says so, and otherwise `description` exactly as stored.
 *
 * The stored row is never rewritten to match — this is a presentation choice
 * made fresh on every read, over an audit trail that stays byte-for-byte what
 * settlement appended.
 */
export function walletDescription(
  row: WalletRow,
  retained: ReadonlyMap<string, RetainedMint>,
): string | null {
  if (row.type !== "purchase" || !row.referenceId) return row.description;
  const mint = retained.get(row.referenceId);
  if (!mint) return row.description;
  return retainedCreditsDescription(row.delta, mint.amountUsd, mint.currency);
}
