import { NextResponse } from "next/server";
import { paypalFetch } from "@/lib/paypal/client";
import { markPaymentStatus, settleCapturedOrder } from "@/lib/paypal/fulfilment";
import {
  handlePayPalWebhook,
  isVerificationSuccess,
  verificationPayload,
} from "@/lib/paypal/webhook";

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

  const result = await handlePayPalWebhook(rawBody, request.headers, {
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
  });

  return NextResponse.json(result.body, { status: result.status });
}
