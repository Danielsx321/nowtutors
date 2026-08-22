import { describe, it, expect, vi } from "vitest";
import {
  handlePayPalWebhook,
  isVerificationSuccess,
  paymentRefFromEvent,
  readSignatureHeaders,
  verificationPayload,
  type WebhookDeps,
} from "@/lib/paypal/webhook";

/**
 * The webhook decision table (SPEC §7.6). The signature is the *only*
 * authorization on this route — the caller is PayPal, not a session — so the
 * central assertion is that an event which doesn't verify is rejected before any
 * lookup, status change, or credit. A forged `PAYMENT.CAPTURE.COMPLETED` would
 * otherwise mint free credits.
 */

const WEBHOOK_ID = "8VW12345XY678901Z";
const ORDER_ID = "5O190127TN364715T";
const CAPTURE_ID = "3C679366HH908993F";

const SIGNED_HEADERS: Record<string, string> = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-abc",
  "paypal-transmission-id": "d0a7d5c0-0000-11ef-9d0e-000000000000",
  "paypal-transmission-sig": "Ab1CdEf2Gh3==",
  "paypal-transmission-time": "2026-08-22T09:00:00Z",
};

function headers(over: Record<string, string | null> = {}) {
  const merged = { ...SIGNED_HEADERS, ...over };
  return {
    get: (name: string) => merged[name.toLowerCase()] ?? null,
  };
}

function captureEvent(eventType: string) {
  return {
    id: "WH-1234",
    event_type: eventType,
    resource: {
      id: CAPTURE_ID,
      status: eventType.endsWith("DENIED") ? "DECLINED" : "COMPLETED",
      supplementary_data: { related_ids: { order_id: ORDER_ID } },
    },
  };
}

/** Deps that record what they were asked to do; verification is settable. */
function deps(over: Partial<WebhookDeps> = {}): WebhookDeps & {
  settleCapturedOrder: ReturnType<typeof vi.fn>;
  markPaymentStatus: ReturnType<typeof vi.fn>;
  verifySignature: ReturnType<typeof vi.fn>;
} {
  return {
    webhookId: WEBHOOK_ID,
    verifySignature: vi.fn(async () => true),
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
    ...over,
  } as never;
}

describe("webhook — an unverified event is rejected and not processed", () => {
  it("400s when PayPal will not vouch for the signature", async () => {
    const d = deps({ verifySignature: vi.fn(async () => false) });
    const event = captureEvent("PAYMENT.CAPTURE.COMPLETED");

    const res = await handlePayPalWebhook(JSON.stringify(event), headers(), d);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/signature/i);
    expect(d.settleCapturedOrder).not.toHaveBeenCalled();
    expect(d.markPaymentStatus).not.toHaveBeenCalled();
  });

  it.each([
    "paypal-auth-algo",
    "paypal-cert-url",
    "paypal-transmission-id",
    "paypal-transmission-sig",
    "paypal-transmission-time",
  ])("400s when %s is missing, without calling PayPal", async (missing) => {
    const d = deps();
    const res = await handlePayPalWebhook(
      JSON.stringify(captureEvent("PAYMENT.CAPTURE.COMPLETED")),
      headers({ [missing]: null }),
      d,
    );
    expect(res.status).toBe(400);
    expect(d.verifySignature).not.toHaveBeenCalled();
    expect(d.settleCapturedOrder).not.toHaveBeenCalled();
  });

  it("400s on a malformed body", async () => {
    const d = deps();
    for (const body of ["", "{not json", '"a string"', "[]"]) {
      const res = await handlePayPalWebhook(body, headers(), d);
      expect(res.status).toBe(400);
    }
    expect(d.settleCapturedOrder).not.toHaveBeenCalled();
  });

  it("503s — not 400 — when PAYPAL_WEBHOOK_ID is unset, so PayPal retries", async () => {
    for (const webhookId of [null, "", "   "]) {
      const d = deps({ webhookId });
      const res = await handlePayPalWebhook(
        JSON.stringify(captureEvent("PAYMENT.CAPTURE.COMPLETED")),
        headers(),
        d,
      );
      expect(res.status).toBe(503);
      expect(d.verifySignature).not.toHaveBeenCalled();
      expect(d.settleCapturedOrder).not.toHaveBeenCalled();
    }
  });

  it("verifies against the configured webhook id and the event as sent", async () => {
    const d = deps();
    const event = captureEvent("PAYMENT.CAPTURE.COMPLETED");
    await handlePayPalWebhook(JSON.stringify(event), headers(), d);
    expect(d.verifySignature).toHaveBeenCalledWith({
      headers: {
        authAlgo: SIGNED_HEADERS["paypal-auth-algo"],
        certUrl: SIGNED_HEADERS["paypal-cert-url"],
        transmissionId: SIGNED_HEADERS["paypal-transmission-id"],
        transmissionSig: SIGNED_HEADERS["paypal-transmission-sig"],
        transmissionTime: SIGNED_HEADERS["paypal-transmission-time"],
      },
      webhookId: WEBHOOK_ID,
      event,
    });
  });
});

describe("webhook — event routing", () => {
  it("COMPLETED settles through the same path the client capture uses", async () => {
    const d = deps();
    const event = captureEvent("PAYMENT.CAPTURE.COMPLETED");
    const res = await handlePayPalWebhook(JSON.stringify(event), headers(), d);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: true, result: "credited" });
    expect(d.settleCapturedOrder).toHaveBeenCalledWith({
      providerOrderId: ORDER_ID,
      providerCaptureId: CAPTURE_ID,
      rawPayload: event,
    });
    expect(d.markPaymentStatus).not.toHaveBeenCalled();
  });

  it("reports already_credited when the client capture got there first", async () => {
    const d = deps({
      settleCapturedOrder: vi.fn(async () => ({
        status: "already_credited" as const,
        paymentId: "p1",
        credits: 30,
      })),
    });
    const res = await handlePayPalWebhook(
      JSON.stringify(captureEvent("PAYMENT.CAPTURE.COMPLETED")),
      headers(),
      d,
    );
    expect(res.status).toBe(200); // a no-op is a success, not a retry
    expect(res.body).toMatchObject({ result: "already_credited" });
  });

  it("DENIED marks the payment failed and never credits", async () => {
    const d = deps();
    const res = await handlePayPalWebhook(
      JSON.stringify(captureEvent("PAYMENT.CAPTURE.DENIED")),
      headers(),
      d,
    );
    expect(res.status).toBe(200);
    expect(d.settleCapturedOrder).not.toHaveBeenCalled();
    expect(d.markPaymentStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", providerOrderId: ORDER_ID }),
    );
  });

  it("REFUNDED marks the payment refunded and never credits", async () => {
    const d = deps();
    const event = {
      id: "WH-9",
      event_type: "PAYMENT.CAPTURE.REFUNDED",
      // The resource is a *refund*, so resource.id is the refund id — the
      // capture must come from related_ids, never from resource.id.
      resource: {
        id: "REFUND-XYZ",
        status: "COMPLETED",
        supplementary_data: {
          related_ids: { order_id: ORDER_ID, capture_id: CAPTURE_ID },
        },
      },
    };
    const res = await handlePayPalWebhook(JSON.stringify(event), headers(), d);
    expect(res.status).toBe(200);
    expect(d.settleCapturedOrder).not.toHaveBeenCalled();
    expect(d.markPaymentStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "refunded",
        providerOrderId: ORDER_ID,
        providerCaptureId: CAPTURE_ID,
      }),
    );
  });

  it("acknowledges an event type we don't handle without touching anything", async () => {
    const d = deps();
    const res = await handlePayPalWebhook(
      JSON.stringify({ id: "WH-2", event_type: "CHECKOUT.ORDER.APPROVED", resource: {} }),
      headers(),
      d,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ handled: false });
    expect(d.settleCapturedOrder).not.toHaveBeenCalled();
    expect(d.markPaymentStatus).not.toHaveBeenCalled();
  });

  it("acknowledges a handled event carrying no usable reference", async () => {
    const d = deps();
    const res = await handlePayPalWebhook(
      JSON.stringify({ event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {} }),
      headers(),
      d,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ result: "unidentifiable" });
    expect(d.settleCapturedOrder).not.toHaveBeenCalled();
  });
});

describe("webhook — reference extraction", () => {
  it("falls back to the order link when supplementary_data is absent", () => {
    const ref = paymentRefFromEvent({
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: {
        id: CAPTURE_ID,
        links: [
          { rel: "self", href: `https://api.paypal.com/v2/payments/captures/${CAPTURE_ID}` },
          { rel: "up", href: `https://api.paypal.com/v2/checkout/orders/${ORDER_ID}` },
        ],
      },
    });
    expect(ref).toEqual({
      providerOrderId: ORDER_ID,
      providerCaptureId: CAPTURE_ID,
    });
  });

  it("returns an empty ref for a shapeless event", () => {
    expect(paymentRefFromEvent(null)).toEqual({});
    expect(paymentRefFromEvent({ event_type: "X" })).toEqual({});
  });
});

describe("webhook — verification helpers", () => {
  it("reads all five signature headers case-insensitively", () => {
    expect(readSignatureHeaders(headers())).toEqual({
      authAlgo: SIGNED_HEADERS["paypal-auth-algo"],
      certUrl: SIGNED_HEADERS["paypal-cert-url"],
      transmissionId: SIGNED_HEADERS["paypal-transmission-id"],
      transmissionSig: SIGNED_HEADERS["paypal-transmission-sig"],
      transmissionTime: SIGNED_HEADERS["paypal-transmission-time"],
    });
    expect(readSignatureHeaders(headers({ "paypal-cert-url": "  " }))).toBeNull();
  });

  it("builds the payload PayPal's verify endpoint expects", () => {
    const event = captureEvent("PAYMENT.CAPTURE.COMPLETED");
    const sig = readSignatureHeaders(headers())!;
    expect(verificationPayload(sig, WEBHOOK_ID, event)).toEqual({
      auth_algo: SIGNED_HEADERS["paypal-auth-algo"],
      cert_url: SIGNED_HEADERS["paypal-cert-url"],
      transmission_id: SIGNED_HEADERS["paypal-transmission-id"],
      transmission_sig: SIGNED_HEADERS["paypal-transmission-sig"],
      transmission_time: SIGNED_HEADERS["paypal-transmission-time"],
      webhook_id: WEBHOOK_ID,
      webhook_event: event,
    });
  });

  it("treats anything but SUCCESS as unverified", () => {
    expect(isVerificationSuccess({ verification_status: "SUCCESS" })).toBe(true);
    for (const r of [
      { verification_status: "FAILURE" },
      { verification_status: "success" },
      {},
      null,
      "SUCCESS",
    ]) {
      expect(isVerificationSuccess(r)).toBe(false);
    }
  });
});
