import "server-only";
import { eq, or, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { payments } from "@/db/schema";
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
