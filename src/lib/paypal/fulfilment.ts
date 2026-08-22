import "server-only";
import { and, eq, or, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { bookings, creditTransactions, payments } from "@/db/schema";
import { walletExecutor } from "@/lib/credits/ledger";
import {
  markStatus,
  settleCapture,
  type MarkResult,
  type PaymentPatch,
  type PaymentRecord,
  type PaymentRef,
  type PaymentStore,
  type SettleResult,
} from "./settlement";

/**
 * Production {@link PaymentStore} — the Drizzle adapter behind
 * `lib/paypal/settlement.ts`. This is the only place PayPal settlement issues
 * SQL: the `SELECT … FOR UPDATE` on `payments`, the status UPDATE, and the
 * SAVEPOINT the ledger append runs in.
 */
function paymentStore(tx: DbTransaction): PaymentStore {
  return {
    async lock(ref: PaymentRef) {
      const orderId = ref.providerOrderId?.trim();
      const captureId = ref.providerCaptureId?.trim();
      if (!orderId && !captureId) return null;

      // The order id is the primary key into `payments`; the capture id is the
      // fallback for events (notably PAYMENT.CAPTURE.REFUNDED) that carry the
      // capture but not the order.
      const match =
        orderId && captureId
          ? or(
              eq(payments.providerOrderId, orderId),
              eq(payments.providerCaptureId, captureId),
            )
          : orderId
            ? eq(payments.providerOrderId, orderId)
            : eq(payments.providerCaptureId, captureId!);

      const [row] = await tx
        .select({
          id: payments.id,
          userId: payments.userId,
          purpose: payments.purpose,
          status: payments.status,
          creditsGranted: payments.creditsGranted,
          amountUsd: payments.amountUsd,
          currency: payments.currency,
          providerCaptureId: payments.providerCaptureId,
          capturedAt: payments.capturedAt,
          bookingId: payments.bookingId,
        })
        .from(payments)
        .where(match)
        .for("update")
        .limit(1);
      return (row as PaymentRecord) ?? null;
    },

    async update(paymentId: string, patch: PaymentPatch) {
      await tx
        .update(payments)
        .set({
          ...(patch.status === undefined ? {} : { status: patch.status }),
          ...(patch.providerCaptureId === undefined
            ? {}
            : { providerCaptureId: patch.providerCaptureId }),
          ...(patch.rawPayload === undefined
            ? {}
            : { rawPayload: patch.rawPayload }),
          ...(patch.capturedAt === undefined
            ? {}
            : { capturedAt: patch.capturedAt }),
          updatedAt: sql`now()`,
        })
        .where(eq(payments.id, paymentId));
    },

    // A Drizzle nested transaction compiles to SAVEPOINT / ROLLBACK TO SAVEPOINT,
    // so a duplicate-reference rejection unwinds only the ledger append and the
    // outer transaction stays usable.
    savepoint(fn) {
      return tx.transaction((inner) => fn(walletExecutor(inner)));
    },

    // Conditional on `pending_payment`, so exactly one of the client capture and
    // the webhook reports having moved it. Same transaction as the payments
    // update: the booking is confirmed iff the payment is recorded captured.
    async confirmBooking(bookingId: string) {
      const moved = await tx
        .update(bookings)
        .set({ status: "confirmed", updatedAt: sql`now()` })
        .where(
          and(
            eq(bookings.id, bookingId),
            eq(bookings.status, "pending_payment"),
          ),
        )
        .returning({ id: bookings.id });
      return moved.length > 0;
    },

    // The direct-pay replay guard, read straight out of the ledger. One query
    // for both legs — the `purchase` mint keyed on payments.id and the
    // `booking_debit` spend keyed on bookings.id. Inside the same transaction
    // (and behind the same `FOR UPDATE` on `payments`) as everything else here,
    // so what it reads is what the writes below will collide with.
    async settledLegs(paymentId: string, bookingId: string) {
      const rows = await tx
        .select({ type: creditTransactions.type })
        .from(creditTransactions)
        .where(
          or(
            and(
              eq(creditTransactions.type, "purchase"),
              eq(creditTransactions.referenceId, paymentId),
            ),
            and(
              eq(creditTransactions.type, "booking_debit"),
              eq(creditTransactions.referenceId, bookingId),
            ),
          ),
        );
      return {
        minted: rows.some((r) => r.type === "purchase"),
        debited: rows.some((r) => r.type === "booking_debit"),
      };
    },
  };
}

/** Record a completed capture and grant the credits, in ONE transaction. */
export function settleCapturedOrder(
  ref: PaymentRef & { rawPayload?: unknown },
): Promise<SettleResult> {
  return db.transaction((tx) => settleCapture(paymentStore(tx), ref));
}

/** Move a payment to `failed` / `refunded` without touching the wallet. */
export function markPaymentStatus(
  ref: PaymentRef & { status: "failed" | "refunded"; rawPayload?: unknown },
): Promise<MarkResult> {
  return db.transaction((tx) => markStatus(paymentStore(tx), ref));
}

/**
 * Record a still-PENDING capture WITHOUT moving `payments.status`. Persists the
 * capture id and raw payload only, so the row stays recoverable by either the
 * `PAYMENT.CAPTURE.COMPLETED` webhook or a retried capture. Deliberately does
 * NOT write `failed` — a PENDING capture is not a decline (SPEC §7.6; see the
 * three-way branch in `lib/paypal/capture.ts`). Uses the same locking store as
 * settlement, but issues no status patch (the store skips an undefined status).
 */
export function recordPendingCapture(
  ref: PaymentRef & { rawPayload?: unknown },
): Promise<MarkResult> {
  return db.transaction(async (tx) => {
    const store = paymentStore(tx);
    const payment = await store.lock(ref);
    if (!payment) return { status: "unknown_order" };
    await store.update(payment.id, {
      providerCaptureId:
        ref.providerCaptureId?.trim() || payment.providerCaptureId,
      ...(ref.rawPayload === undefined ? {} : { rawPayload: ref.rawPayload }),
    });
    return { status: "updated", paymentId: payment.id };
  });
}
