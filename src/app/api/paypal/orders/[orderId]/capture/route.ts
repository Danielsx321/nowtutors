import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { payments } from "@/db/schema";
import { authErrorResponse, requireApiRole } from "@/lib/auth/api-guards";
import {
  capturePayPalOrder,
  captureIdFrom,
  getPayPalOrder,
  hasPayPalIssue,
  isOrderCompleted,
  ORDER_ALREADY_CAPTURED,
  type PayPalOrder,
} from "@/lib/paypal/orders";
import { PayPalApiError, PayPalConfigError } from "@/lib/paypal/client";
import { markPaymentStatus, settleCapturedOrder } from "@/lib/paypal/fulfilment";

/**
 * `POST /api/paypal/orders/[orderId]/capture` — capture an approved order and
 * grant the credits (SPEC §7.6).
 *
 * Ownership is checked against `payments.user_id` from the session before PayPal
 * is called at all: the order id is guessable-ish and must never let one account
 * capture into another's wallet. The credit itself runs through
 * `settleCapturedOrder`, the same function the webhook calls with the same
 * `reference_id`, so whichever gets there second is a no-op via the ledger's
 * `(type, reference_id)` unique index.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  let user;
  try {
    user = await requireApiRole("student");
  } catch (err) {
    const res = authErrorResponse(err);
    if (res) return res;
    throw err;
  }

  const { orderId } = await params;
  if (!orderId?.trim()) {
    return NextResponse.json({ error: "Missing order id." }, { status: 400 });
  }

  const [payment] = await db
    .select({
      id: payments.id,
      userId: payments.userId,
      status: payments.status,
      creditsGranted: payments.creditsGranted,
    })
    .from(payments)
    .where(eq(payments.providerOrderId, orderId))
    .limit(1);

  if (!payment) {
    return NextResponse.json({ error: "Payment not found." }, { status: 404 });
  }
  if (payment.userId !== user.id) {
    return NextResponse.json({ error: "Payment not found." }, { status: 404 });
  }
  if (payment.status === "refunded" || payment.status === "failed") {
    return NextResponse.json(
      { error: "This payment can no longer be captured." },
      { status: 409 },
    );
  }
  if (payment.status === "captured") {
    // The webhook (or a double-click) already got here. Nothing to re-capture.
    return NextResponse.json({
      ok: true,
      result: "already_captured",
      credits: payment.creditsGranted ?? 0,
    });
  }

  let order: PayPalOrder;
  try {
    order = await capturePayPalOrder(orderId);
  } catch (err) {
    // A double-submit can race PayPal itself; the order is captured, we just
    // didn't get the response. Re-read it and settle from that.
    if (hasPayPalIssue(err, ORDER_ALREADY_CAPTURED)) {
      order = await getPayPalOrder(orderId);
    } else if (err instanceof PayPalConfigError) {
      return NextResponse.json(
        { error: "Payments aren't available right now." },
        { status: 503 },
      );
    } else if (err instanceof PayPalApiError) {
      return NextResponse.json(
        { error: "PayPal declined this payment. Please try another method." },
        { status: 502 },
      );
    } else {
      throw err;
    }
  }

  if (!isOrderCompleted(order)) {
    // Declined or still pending — never credit on anything but COMPLETED. A
    // pending capture that later completes arrives on the webhook.
    await markPaymentStatus({
      providerOrderId: orderId,
      providerCaptureId: captureIdFrom(order),
      status: "failed",
      rawPayload: order,
    });
    return NextResponse.json(
      { error: "That payment wasn't completed.", paypalStatus: order.status ?? null },
      { status: 409 },
    );
  }

  const result = await settleCapturedOrder({
    providerOrderId: orderId,
    providerCaptureId: captureIdFrom(order),
    rawPayload: order,
  });

  if (result.status === "unknown_order") {
    // Can't happen — we loaded the row above — but never claim success blindly.
    return NextResponse.json({ error: "Payment not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    result: result.status,
    credits: result.status === "captured_no_credit" ? 0 : result.credits,
    ...(result.status === "credited" ? { balance: result.balanceAfter } : {}),
  });
}
