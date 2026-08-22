import "server-only";
import { paypalFetch, PayPalApiError } from "./client";

/**
 * The PayPal Orders v2 calls we make (SPEC §7.6): create an order for a
 * server-computed amount, and capture it. Response shapes are typed only as far
 * as we read them — PayPal's payloads are large and we store the whole thing in
 * `payments.raw_payload` for disputes rather than modelling it.
 */

export interface PayPalOrder {
  id: string;
  status?: string;
  links?: Array<{ href?: string; rel?: string; method?: string }>;
  purchase_units?: Array<{
    custom_id?: string;
    payments?: {
      captures?: Array<{ id?: string; status?: string }>;
    };
  }>;
}

export interface CreateOrderParams {
  /** 2-decimal string, computed server-side. Never a client-supplied value. */
  amountValue: string;
  currency: string;
  /** Shown in the PayPal UI. */
  description: string;
  /** Our `payments.id`, echoed back on the capture and on webhook events. */
  customId: string;
  /** Our own reference, shown on the buyer's PayPal statement. */
  invoiceId?: string;
}

/**
 * Create a PayPal order. `PayPal-Request-Id` is set to our payment id so a
 * retried create (network blip, double submit) returns the *same* PayPal order
 * rather than opening a second one the buyer could pay twice.
 */
export function createPayPalOrder(p: CreateOrderParams): Promise<PayPalOrder> {
  return paypalFetch<PayPalOrder>("/v2/checkout/orders", {
    method: "POST",
    requestId: p.customId,
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: p.customId,
          ...(p.invoiceId ? { invoice_id: p.invoiceId } : {}),
          description: p.description,
          amount: { currency_code: p.currency, value: p.amountValue },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            shipping_preference: "NO_SHIPPING",
            user_action: "PAY_NOW",
          },
        },
      },
    },
  });
}

/** PayPal's issue code when an order has already been captured. */
export const ORDER_ALREADY_CAPTURED = "ORDER_ALREADY_CAPTURED";

/** True when a PayPal error body carries `issue`. */
export function hasPayPalIssue(err: unknown, issue: string): boolean {
  if (!(err instanceof PayPalApiError)) return false;
  const body = err.body as { details?: Array<{ issue?: unknown }> } | null;
  return !!body?.details?.some((d) => d?.issue === issue);
}

export function capturePayPalOrder(orderId: string): Promise<PayPalOrder> {
  return paypalFetch<PayPalOrder>(
    `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
    // The order id is a natural idempotency key: PayPal replays the original
    // capture response instead of charging twice on a retry.
    { method: "POST", requestId: `capture:${orderId}`, body: {} },
  );
}

export function getPayPalOrder(orderId: string): Promise<PayPalOrder> {
  return paypalFetch<PayPalOrder>(
    `/v2/checkout/orders/${encodeURIComponent(orderId)}`,
    { method: "GET" },
  );
}
