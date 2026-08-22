import { describe, it, expect, vi } from "vitest";
import {
  captureIdFrom,
  isOrderCompleted,
  isOrderPending,
  settleCaptureOutcome,
  type CaptureSettlementDeps,
} from "@/lib/paypal/capture";
import type { PayPalOrder } from "@/lib/paypal/orders";

/**
 * The client capture decision (SPEC §7.6): branch on PayPal's returned capture
 * status. The assertion that matters is the PENDING branch — a capture that is
 * accepted but not yet final must NOT be written as `failed` (which would be
 * indistinguishable from a hard decline). It stays recoverable by the
 * `PAYMENT.CAPTURE.COMPLETED` webhook or a retried capture, so on PENDING we
 * persist the capture id + raw payload only and leave `payments.status` alone.
 */

const ORDER_ID = "5O190127TN364715T";
const CAPTURE_ID = "3C679366HH908993F";

/** Deps that record what they were asked to do. */
function deps(over: Partial<CaptureSettlementDeps> = {}): CaptureSettlementDeps & {
  settleCapturedOrder: ReturnType<typeof vi.fn>;
  markPaymentStatus: ReturnType<typeof vi.fn>;
  recordPendingCapture: ReturnType<typeof vi.fn>;
} {
  return {
    settleCapturedOrder: vi.fn(async () => ({
      status: "credited" as const,
      paymentId: "p1",
      credits: 30,
      balanceAfter: 30,
    })),
    markPaymentStatus: vi.fn(async () => ({
      status: "updated" as const,
      paymentId: "p1",
    })),
    recordPendingCapture: vi.fn(async () => ({
      status: "updated" as const,
      paymentId: "p1",
    })),
    ...over,
  } as never;
}

/** An order whose single capture carries `status`, mirroring PayPal's shape. */
function orderWithCaptureStatus(status: string): PayPalOrder {
  return {
    id: ORDER_ID,
    status: status === "COMPLETED" ? "COMPLETED" : "CREATED",
    purchase_units: [{ payments: { captures: [{ id: CAPTURE_ID, status }] } }],
  };
}

describe("settleCaptureOutcome — PENDING is not a failure", () => {
  it("persists the capture id + raw payload, leaves payments.status untouched, and 202s", async () => {
    const d = deps();
    const order = orderWithCaptureStatus("PENDING");

    const outcome = await settleCaptureOutcome(ORDER_ID, order, d);

    // response is 202
    expect(outcome.status).toBe(202);
    expect(outcome.body).toMatchObject({ ok: false, result: "pending" });

    // providerCaptureId and rawPayload are written — and nothing else
    expect(d.recordPendingCapture).toHaveBeenCalledTimes(1);
    expect(d.recordPendingCapture).toHaveBeenCalledWith({
      providerOrderId: ORDER_ID,
      providerCaptureId: CAPTURE_ID,
      rawPayload: order,
    });

    // payments.status is unchanged: the only status-writer on this route is
    // markPaymentStatus, and it is never called on PENDING.
    expect(d.markPaymentStatus).not.toHaveBeenCalled();

    // no wallet or ledger write occurs: settlement (the only crediting path) is
    // never invoked.
    expect(d.settleCapturedOrder).not.toHaveBeenCalled();
  });

  it("also treats a top-level PENDING order status as pending", async () => {
    const d = deps();
    const outcome = await settleCaptureOutcome(
      ORDER_ID,
      { id: ORDER_ID, status: "PENDING" },
      d,
    );
    expect(outcome.status).toBe(202);
    expect(d.recordPendingCapture).toHaveBeenCalledTimes(1);
    expect(d.markPaymentStatus).not.toHaveBeenCalled();
    expect(d.settleCapturedOrder).not.toHaveBeenCalled();
  });
});

describe("settleCaptureOutcome — COMPLETED credits, terminal fails", () => {
  it("COMPLETED settles through the crediting path and 200s", async () => {
    const d = deps();
    const order = orderWithCaptureStatus("COMPLETED");
    const outcome = await settleCaptureOutcome(ORDER_ID, order, d);

    expect(outcome.status).toBe(200);
    expect(outcome.body).toMatchObject({ ok: true, result: "credited", balance: 30 });
    expect(d.settleCapturedOrder).toHaveBeenCalledWith({
      providerOrderId: ORDER_ID,
      providerCaptureId: CAPTURE_ID,
      rawPayload: order,
    });
    expect(d.recordPendingCapture).not.toHaveBeenCalled();
    expect(d.markPaymentStatus).not.toHaveBeenCalled();
  });

  it.each(["DECLINED", "FAILED"])(
    "a terminal %s capture is marked failed and 409s",
    async (status) => {
      const d = deps();
      const order = orderWithCaptureStatus(status);
      const outcome = await settleCaptureOutcome(ORDER_ID, order, d);

      expect(outcome.status).toBe(409);
      expect(d.markPaymentStatus).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed", providerOrderId: ORDER_ID }),
      );
      expect(d.recordPendingCapture).not.toHaveBeenCalled();
      expect(d.settleCapturedOrder).not.toHaveBeenCalled();
    },
  );
});

describe("capture — pure order-shape readers", () => {
  it("classifies COMPLETED / PENDING and reads the capture id", () => {
    expect(isOrderCompleted(orderWithCaptureStatus("COMPLETED"))).toBe(true);
    expect(isOrderCompleted(orderWithCaptureStatus("PENDING"))).toBe(false);
    expect(isOrderPending(orderWithCaptureStatus("PENDING"))).toBe(true);
    expect(isOrderPending(orderWithCaptureStatus("COMPLETED"))).toBe(false);
    expect(captureIdFrom(orderWithCaptureStatus("PENDING"))).toBe(CAPTURE_ID);
    expect(captureIdFrom({ id: ORDER_ID })).toBeNull();
  });
});
