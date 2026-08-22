import {
  creditWallet,
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
}

export type SettleResult =
  | { status: "credited"; paymentId: string; credits: number; balanceAfter: number }
  | { status: "already_credited"; paymentId: string; credits: number }
  | { status: "captured_no_credit"; paymentId: string }
  | { status: "unknown_order" };

export type MarkResult =
  | { status: "updated"; paymentId: string }
  | { status: "unknown_order" };

/** Wallet-history text for a purchase (SPEC §7.10 shows this in the ledger). */
export function purchaseDescription(payment: PaymentRecord, credits: number): string {
  return `Credit purchase — ${credits} credits ($${payment.amountUsd} ${payment.currency})`;
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

  // Booking direct-pay (Part 2) confirms a booking here instead of crediting.
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
