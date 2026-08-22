import { NextResponse } from "next/server";
import { paypalFetch } from "@/lib/paypal/client";
import { markPaymentStatus, settleCapturedOrder } from "@/lib/paypal/fulfilment";
import {
  handlePayPalWebhook,
  isVerificationSuccess,
  verificationPayload,
} from "@/lib/paypal/webhook";
import {
  PAYPAL_UNAVAILABLE_BODY,
  PAYPAL_UNAVAILABLE_STATUS,
  withPayPalConfigBoundary,
} from "@/lib/paypal/config-boundary";

/**
 * `POST /api/webhooks/paypal` (SPEC §7.6). A thin adapter: read the raw body
 * (the signature covers those exact bytes), then hand everything to the pure
 * `handlePayPalWebhook`, which owns the decision table and is unit-tested.
 *
 * Unauthenticated by design — the caller is PayPal, not a session — so the
 * *signature* is the authorization. An event that doesn't verify is rejected
 * with 400 before any lookup or write.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rawBody = await request.text();

  // Missing PayPal credentials would otherwise throw out of verifySignature and
  // reach PayPal as an uncaught 500 with a stack trace. It is a server
  // misconfiguration and retryable once fixed — the same reasoning as the unset
  // PAYPAL_WEBHOOK_ID 503 the pure handler already returns.
  const result = await withPayPalConfigBoundary(
    "POST /api/webhooks/paypal",
    () =>
      handlePayPalWebhook(rawBody, request.headers, {
        webhookId: process.env.PAYPAL_WEBHOOK_ID ?? null,
        async verifySignature({ headers, webhookId, event }) {
          const response = await paypalFetch<unknown>(
            "/v1/notifications/verify-webhook-signature",
            { method: "POST", body: verificationPayload(headers, webhookId, event) },
          );
          return isVerificationSuccess(response);
        },
        settleCapturedOrder,
        markPaymentStatus,
      }),
    () => ({
      status: PAYPAL_UNAVAILABLE_STATUS,
      body: { ...PAYPAL_UNAVAILABLE_BODY },
    }),
  );

  return NextResponse.json(result.body, { status: result.status });
}
