import {
  creditWallet,
  debitWallet,
  DuplicateLedgerReferenceError,
  type LedgerExecutor,
} from "@/lib/credits/ledger";
import type { paymentPurpose, paymentStatus } from "@/db/schema/enums";

/**
 * The single capture→credit decision path (SPEC §7.6). Both callers run it: the
 * client capture route (`/api/paypal/orders/[orderId]/capture`) and the
 * `PAYMENT.CAPTURE.COMPLETED` webhook, which is the backstop for a buyer who
 * closes the tab mid-capture.
 *
 * They are not special-cased against each other. Whichever arrives first credits
 * the wallet; the second hits the `(type, reference_id)` unique index on
 * `credit_transactions` — the *same* `reference_id` either way, our
 * `payments.id` — and returns `already_credited`. That index is the idempotency
 * guard (SPEC §4.4); nothing here re-implements it.
 *
 * Pure and storage-agnostic, exactly as the ledger is (docs/DECISIONS.md,
 * Phase 4 Part 2): it drives a `PaymentStore` rather than a Drizzle transaction,
 * so the money invariants — credit once, no double-credit on a client/webhook
 * race, no crediting on DENIED/REFUNDED, and **a captured payment is always
 * honoured** — are unit-testable without a live Postgres.
 * `lib/paypal/fulfilment.ts` is the production adapter.
 */

export type PaymentPurpose = (typeof paymentPurpose.enumValues)[number];
export type PaymentStatus = (typeof paymentStatus.enumValues)[number];

/** How a PayPal capture response or webhook event identifies our payment. */
export interface PaymentRef {
  providerOrderId?: string | null;
  providerCaptureId?: string | null;
}

/** The `payments` columns settlement reads. */
export interface PaymentRecord {
  id: string;
  userId: string;
  purpose: PaymentPurpose;
  status: PaymentStatus;
  creditsGranted: number | null;
  amountUsd: string;
  currency: string;
  providerCaptureId: string | null;
  capturedAt: Date | null;
  /** Set when `purpose = 'booking'` (direct-pay, Part 2). */
  bookingId?: string | null;
}

export interface PaymentPatch {
  status?: PaymentStatus;
  providerCaptureId?: string | null;
  rawPayload?: unknown;
  capturedAt?: Date;
}

/**
 * The storage surface settlement needs, all inside one transaction. The
 * production adapter wraps a Drizzle transaction; tests provide an in-memory one.
 */
export interface PaymentStore {
  /**
   * Lock (`FOR UPDATE`) and read the payment a reference points at, so a client
   * capture and a webhook arriving together serialize instead of interleaving.
   */
  lock(ref: PaymentRef): Promise<PaymentRecord | null>;
  update(paymentId: string, patch: PaymentPatch): Promise<void>;
  /**
   * Run `fn` inside a nested transaction (a Postgres SAVEPOINT) with a ledger
   * executor bound to it. The savepoint is load-bearing: a duplicate-key
   * rejection must unwind only the ledger append. Without it the unique
   * violation would poison the whole transaction and roll back the `payments`
   * status update alongside it.
   */
  savepoint<T>(fn: (ledger: LedgerExecutor) => Promise<T>): Promise<T>;
  /**
   * Flip a `pending_payment` booking to `confirmed` (direct-pay, §7.3 step 4b).
   * Returns true iff this call is the one that moved it — the update is
   * conditional on the row still being `pending_payment`, which is what makes a
   * client/webhook race land exactly once. Optional so a store built before
   * Part 2 keeps type-checking; a booking payment without it is left for the
   * other path to confirm rather than silently reported as done.
   */
  confirmBooking?(bookingId: string): Promise<boolean>;
  /**
   * Read back which of the two direct-pay legs are already in the ledger: the
   * mint (`purchase` / `payments.id`) and the spend (`booking_debit` /
   * `bookings.id`). This is the replay guard, and it is a *read of the ledger*
   * rather than an inference about ordering — see `settleCapture`, where the
   * spend is gated on the confirm and a committed mint therefore no longer
   * implies a committed spend. Optional alongside {@link confirmBooking}: the
   * two together are the direct-pay capability, and a store offering one
   * without the other declines to settle rather than settling half-guarded.
   */
  settledLegs?(
    paymentId: string,
    bookingId: string,
  ): Promise<{ minted: boolean; debited: boolean }>;
}

export type SettleResult =
  | { status: "credited"; paymentId: string; credits: number; balanceAfter: number }
  | { status: "already_credited"; paymentId: string; credits: number }
  | { status: "captured_no_credit"; paymentId: string }
  | { status: "booking_confirmed"; paymentId: string; bookingId: string }
  | { status: "booking_already_confirmed"; paymentId: string; bookingId: string }
  /**
   * The capture was honoured but the slot was gone: the minted credits stay in
   * the student's wallet and the booking was never confirmed. Distinct from
   * `booking_already_confirmed`, which means an idempotent replay of a
   * settlement that *did* confirm — reporting this case as that one would call
   * a lost booking a success (SPEC §7.6).
   */
  | {
      status: "booking_unavailable_credits_retained";
      paymentId: string;
      bookingId: string;
      credits: number;
    }
  | { status: "unknown_order" };

export type MarkResult =
  | { status: "updated"; paymentId: string }
  | { status: "unknown_order" };

/** Wallet-history text for a purchase (SPEC §7.10 shows this in the ledger). */
export function purchaseDescription(payment: PaymentRecord, credits: number): string {
  return `Credit purchase — ${credits} credits ($${payment.amountUsd} ${payment.currency})`;
}

/**
 * Run a ledger append and report whether it was rejected as a duplicate — the
 * `(type, reference_id)` unique index doing its job on a replay (SPEC §4.4).
 * Anything else propagates.
 */
async function isDuplicate(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
    return false;
  } catch (err) {
    if (err instanceof DuplicateLedgerReferenceError) return true;
    throw err;
  }
}

/**
 * Record a completed PayPal capture and grant the credits. The status update and
 * the ledger append are one unit of work: both land or neither does.
 */
export async function settleCapture(
  store: PaymentStore,
  ref: PaymentRef & { rawPayload?: unknown },
  now: () => Date = () => new Date(),
): Promise<SettleResult> {
  const payment = await store.lock(ref);
  if (!payment) return { status: "unknown_order" };

  // A late COMPLETED must not resurrect a payment we have since refunded.
  if (payment.status !== "refunded") {
    await store.update(payment.id, {
      status: "captured",
      providerCaptureId:
        ref.providerCaptureId?.trim() || payment.providerCaptureId,
      ...(ref.rawPayload === undefined ? {} : { rawPayload: ref.rawPayload }),
      capturedAt: payment.capturedAt ?? now(),
    });
  }

  // Booking direct-pay (Part 2). Deliberately the SAME settlement path, branched
  // on `payments.purpose`, so client capture and webhook stay one code path.
  //
  // Direct-pay is **buy-then-spend in one checkout**: a booking has no USD price
  // of its own — credits are the unit of account and USD exists only where
  // credits are sold — so the order mints exactly the credits the booking costs
  // and immediately spends them. Net wallet effect is zero, which is correct:
  // the student never held these credits, and reconcile-wallets still balances
  // because both legs are real ledger rows.
  //
  // **A captured payment is always honoured.** The mint runs first and
  // unconditionally; the spend is gated on the booking actually confirming. If
  // the slot is gone — swept to `expired` while the capture was in flight — the
  // student keeps the minted credits and can rebook immediately with credits
  // they already hold. They lost the slot, not the money. This is the only
  // outcome that requires no refund, which is what makes it the right one: SPEC
  // has no refund path (§18 item 4). The previous order — mint, spend, then
  // confirm — charged the card, emptied the wallet again, confirmed nothing,
  // and returned 200 so PayPal never retried: a silently lost payment.
  if (payment.purpose === "booking") {
    const bookingId = payment.bookingId?.trim();
    const credits = payment.creditsGranted ?? 0;
    // Nothing to settle (or a store predating Part 2): the capture is recorded
    // above; don't claim a confirmation we didn't make.
    if (!bookingId || credits <= 0 || !store.confirmBooking || !store.settledLegs) {
      return { status: "captured_no_credit", paymentId: payment.id };
    }
    // Bound, because both are optional members and the store implementations
    // are objects with `this`-dependent bodies.
    const confirmBooking = store.confirmBooking.bind(store);
    const settledLegs = store.settledLegs.bind(store);

    /**
     * What a replay reports, read out of the ledger.
     *
     * The old guard — "a duplicate mint proves the whole settlement already
     * ran" — was sound only while the spend unconditionally followed the mint.
     * It no longer does, so a committed `purchase` may now stand with **no**
     * `booking_debit` beside it, and "already minted" alone cannot tell
     *   (a) mint + confirm + debit  from  (b) mint, confirm failed, no debit.
     * The spend is written iff the confirm returned true, in this same
     * transaction, so the presence of the `booking_debit` row *is* the record
     * of whether the booking was confirmed — nothing is inferred from ordering.
     *
     * Both cases replay as a no-op: no re-mint, no re-debit, and case (b) is
     * never debited retroactively even if the booking has somehow become
     * confirmable since. The money question was settled when the capture was
     * honoured; a later replay does not reopen it.
     */
    const replayed = async (debited: boolean): Promise<SettleResult> =>
      debited
        ? { status: "booking_already_confirmed", paymentId: payment.id, bookingId }
        : {
            status: "booking_unavailable_credits_retained",
            paymentId: payment.id,
            bookingId,
            credits,
          };

    const legs = await settledLegs(payment.id, bookingId);
    if (legs.minted) return replayed(legs.debited);

    // 1. MINT — unconditional. `purchase` / payments.id, the same reference id
    //    the credit-purchase path uses, so both capture paths collide on it.
    //    The savepoint is load-bearing: in Postgres a unique violation aborts
    //    the whole transaction unless it is unwound, which would roll back the
    //    `payments` status update alongside it.
    const raced = await isDuplicate(() =>
      store.savepoint((ledger) =>
        creditWallet(ledger, {
          userId: payment.userId,
          delta: credits,
          type: "purchase",
          referenceType: "payment",
          referenceId: payment.id,
          description: purchaseDescription(payment, credits),
        }),
      ),
    );
    if (raced) {
      // The read above missed a settlement that committed between the probe and
      // the insert. `lock()` takes `FOR UPDATE` on the payment so this should be
      // unreachable, but the unique index — not the read — is the real guard,
      // and a race must still land exactly one mint.
      return replayed((await settledLegs(payment.id, bookingId)).debited);
    }

    // 2. CONFIRM — conditional on the row still being `pending_payment`, so
    //    whichever of the client capture / webhook arrives second moves nothing.
    const confirmed = await confirmBooking(bookingId);

    if (!confirmed) {
      // The slot is gone. The money stays with the student as credits, and the
      // mint stands exactly as it was appended — settlement writes nothing
      // further. The wallet's "credits retained" wording is derived on read
      // (`lib/credits/retained-credits.ts`) from the missing `booking_debit`,
      // because `credit_transactions` is append-only without exception (§4.4).
      return {
        status: "booking_unavailable_credits_retained",
        paymentId: payment.id,
        bookingId,
        credits,
      };
    }

    // 3. SPEND — only now, and only because the booking is confirmed. Same
    //    outer transaction as the mint and the confirm: all three land or none
    //    do. Still guarded defensively — a pre-existing `booking_debit` for this
    //    booking must not become an error.
    await isDuplicate(() =>
      store.savepoint((ledger) =>
        debitWallet(ledger, {
          userId: payment.userId,
          amount: credits,
          type: "booking_debit",
          referenceType: "booking",
          referenceId: bookingId,
          description: `Session paid directly (${credits} credits)`,
        }),
      ),
    );

    return { status: "booking_confirmed", paymentId: payment.id, bookingId };
  }

  const credits = payment.creditsGranted ?? 0;
  if (payment.purpose !== "credit_purchase" || credits <= 0) {
    return { status: "captured_no_credit", paymentId: payment.id };
  }

  try {
    const { balanceAfter } = await store.savepoint((ledger) =>
      creditWallet(ledger, {
        userId: payment.userId,
        delta: credits,
        type: "purchase",
        referenceType: "payment",
        referenceId: payment.id,
        description: purchaseDescription(payment, credits),
      }),
    );
    return { status: "credited", paymentId: payment.id, credits, balanceAfter };
  } catch (err) {
    if (err instanceof DuplicateLedgerReferenceError) {
      // The other path already credited this payment. Not an error — this is
      // precisely what the unique index is for.
      return { status: "already_credited", paymentId: payment.id, credits };
    }
    throw err;
  }
}

/**
 * Move a payment to a terminal non-crediting status — `failed` for
 * `PAYMENT.CAPTURE.DENIED`, `refunded` for `PAYMENT.CAPTURE.REFUNDED`. Neither
 * touches the wallet: a denied capture never credited, and clawing credits back
 * on a refund is an admin action (§18 item 4 — no automatic refunds), not
 * something a webhook does silently.
 */
export async function markStatus(
  store: PaymentStore,
  ref: PaymentRef & { status: "failed" | "refunded"; rawPayload?: unknown },
): Promise<MarkResult> {
  const payment = await store.lock(ref);
  if (!payment) return { status: "unknown_order" };

  await store.update(payment.id, {
    status: ref.status,
    providerCaptureId:
      ref.providerCaptureId?.trim() || payment.providerCaptureId,
    ...(ref.rawPayload === undefined ? {} : { rawPayload: ref.rawPayload }),
  });

  return { status: "updated", paymentId: payment.id };
}
