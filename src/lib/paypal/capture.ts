import type { PayPalOrder } from "./orders";
import type { MarkResult, PaymentRef, SettleResult } from "./settlement";

/**
 * The client capture decision (SPEC §7.6) — what to do with the order PayPal
 * hands back from `POST /v2/checkout/orders/{id}/capture`.
 *
 * Deliberately pure and dependency-injected, in the same spirit as
 * `handlePayPalWebhook` and the ledger's `LedgerExecutor` (docs/DECISIONS.md,
 * Phase 4 Part 2 / Phase 5 Part 1): settlement, status marking, and the
 * pending-capture write all arrive as `CaptureSettlementDeps`, so the three-way
 * branch — credit on COMPLETED, leave a PENDING row untouched, fail a terminal
 * decline — is unit-testable without a live Postgres, PayPal credentials, or a
 * running Next server. The route handler at
 * `app/api/paypal/orders/[orderId]/capture/route.ts` is the thin adapter that
 * authenticates, loads the payment, calls PayPal, and wires the real deps.
 *
 * The pure order-shape readers live here too (they were previously in
 * `orders.ts`, which carries `server-only` and so cannot be imported by a unit
 * test), leaving `orders.ts` to own only the calls that actually hit PayPal.
 */

/** The capture id out of a capture/get-order response, if PayPal recorded one. */
export function captureIdFrom(order: PayPalOrder): string | null {
  for (const unit of order.purchase_units ?? []) {
    for (const capture of unit.payments?.captures ?? []) {
      if (typeof capture.id === "string" && capture.id) return capture.id;
    }
  }
  return null;
}

/** True when the order is fully captured (i.e. the money is ours). */
export function isOrderCompleted(order: PayPalOrder): boolean {
  if (order.status === "COMPLETED") return true;
  return (order.purchase_units ?? []).some((u) =>
    (u.payments?.captures ?? []).some((c) => c.status === "COMPLETED"),
  );
}

/**
 * True when the capture is accepted but not yet final (PayPal `PENDING`) — e.g.
 * a payment under review. This is neither success nor a decline: PayPal resolves
 * it asynchronously and the `PAYMENT.CAPTURE.COMPLETED` webhook is the backstop.
 */
export function isOrderPending(order: PayPalOrder): boolean {
  if (order.status === "PENDING") return true;
  return (order.purchase_units ?? []).some((u) =>
    (u.payments?.captures ?? []).some((c) => c.status === "PENDING"),
  );
}

/** The settlement side-effects the capture decision drives. */
export interface CaptureSettlementDeps {
  settleCapturedOrder(
    ref: PaymentRef & { rawPayload?: unknown },
  ): Promise<SettleResult>;
  markPaymentStatus(
    ref: PaymentRef & { status: "failed" | "refunded"; rawPayload?: unknown },
  ): Promise<MarkResult>;
  /**
   * Persist a still-PENDING capture WITHOUT moving `payments.status`: record the
   * capture id and raw payload only. See {@link settleCaptureOutcome}.
   */
  recordPendingCapture(
    ref: PaymentRef & { rawPayload?: unknown },
  ): Promise<MarkResult>;
}

/** An HTTP outcome the route serializes verbatim. */
export interface CaptureOutcome {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Branch on PayPal's returned capture status and drive the matching settlement.
 *
 * - **COMPLETED** — the money is ours: settle through the same `settleCapture`
 *   path the webhook uses (same `reference_id`, so a race is a no-op via the
 *   ledger's `(type, reference_id)` unique index). 200.
 * - **PENDING** — accepted but not final. Persist `providerCaptureId` and
 *   `rawPayload` only and DO NOT write `payments.status`. Writing `failed` here
 *   (the old behaviour) is indistinguishable from a hard decline, yet a PENDING
 *   capture may still complete — the `PAYMENT.CAPTURE.COMPLETED` webhook or a
 *   retried capture is what should resolve it. Leaving the status untouched
 *   keeps the row recoverable by either. 202.
 * - **Terminal (DECLINED / FAILED / anything non-recoverable)** — write
 *   `status: "failed"` and 409, unchanged.
 */
export async function settleCaptureOutcome(
  orderId: string,
  order: PayPalOrder,
  deps: CaptureSettlementDeps,
): Promise<CaptureOutcome> {
  if (isOrderCompleted(order)) {
    const result = await deps.settleCapturedOrder({
      providerOrderId: orderId,
      providerCaptureId: captureIdFrom(order),
      rawPayload: order,
    });

    if (result.status === "unknown_order") {
      // Can't happen — the route loaded the row before calling PayPal — but
      // never claim success blindly.
      return { status: 404, body: { error: "Payment not found." } };
    }

    return {
      status: 200,
      body: {
        ok: true,
        result: result.status,
        credits: result.status === "captured_no_credit" ? 0 : result.credits,
        ...(result.status === "credited" ? { balance: result.balanceAfter } : {}),
      },
    };
  }

  if (isOrderPending(order)) {
    await deps.recordPendingCapture({
      providerOrderId: orderId,
      providerCaptureId: captureIdFrom(order),
      rawPayload: order,
    });
    return {
      status: 202,
      body: { ok: false, result: "pending", paypalStatus: order.status ?? null },
    };
  }

  // Terminal decline/failure — safe to mark failed; a retry cannot recover it.
  await deps.markPaymentStatus({
    providerOrderId: orderId,
    providerCaptureId: captureIdFrom(order),
    status: "failed",
    rawPayload: order,
  });
  return {
    status: 409,
    body: {
      error: "That payment wasn't completed.",
      paypalStatus: order.status ?? null,
    },
  };
}
