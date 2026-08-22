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
 * race, no crediting on DENIED/REFUNDED — are unit-testable without a live
 * Postgres. `lib/paypal/fulfilment.ts` is the production adapter.
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
}

export type SettleResult =
  | { status: "credited"; paymentId: string; credits: number; balanceAfter: number }
  | { status: "already_credited"; paymentId: string; credits: number }
  | { status: "captured_no_credit"; paymentId: string }
  | { status: "booking_confirmed"; paymentId: string; bookingId: string }
  | { status: "booking_already_confirmed"; paymentId: string; bookingId: string }
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
  if (payment.purpose === "booking") {
    const bookingId = payment.bookingId?.trim();
    const credits = payment.creditsGranted ?? 0;
    // Nothing to settle (or a store predating Part 2): the capture is recorded
    // above; don't claim a confirmation we didn't make.
    if (!bookingId || credits <= 0 || !store.confirmBooking) {
      return { status: "captured_no_credit", paymentId: payment.id };
    }

    // Each leg is guarded by the (type, reference_id) unique index —
    // `purchase`/payments.id and `booking_debit`/bookings.id — and each runs in
    // its own SAVEPOINT, for the same reason the credit path does: in Postgres
    // a unique violation aborts the whole transaction unless it is unwound.
    //
    // The mint's duplicate is the signal that the WHOLE settlement already ran:
    // both legs land in one transaction, so either both rows exist or neither
    // does. The spend is therefore skipped on a replay rather than retried —
    // retrying it would hit the balance check (which `applyDelta` evaluates
    // *before* the unique index) and raise InsufficientCredits on a wallet that
    // is simply back to its pre-purchase balance, turning a benign replay into
    // an error.
    const alreadySettled = await isDuplicate(() =>
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

    if (!alreadySettled) {
      // Cannot be a duplicate if the mint wasn't, but stay defensive: a
      // pre-existing booking_debit for this booking must not become an error.
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
    }

    // Conditional on the row still being `pending_payment`, so whichever of the
    // client capture / webhook arrives second moves nothing and says so.
    const moved = await store.confirmBooking(bookingId);
    return {
      status: moved ? "booking_confirmed" : "booking_already_confirmed",
      paymentId: payment.id,
      bookingId,
    };
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
