import type { MarkResult, PaymentRef, SettleResult } from "./settlement";

/**
 * PayPal webhook handling (SPEC §7.6) — the backstop for a buyer who closes the
 * tab between approval and capture.
 *
 * Deliberately pure and dependency-injected, in the same spirit as the ledger's
 * `LedgerExecutor` (docs/DECISIONS.md, Phase 4 Part 2): signature verification,
 * settlement, and status marking all arrive as `WebhookDeps`, so the decision
 * table — *reject an unverified event before touching anything*, credit on
 * COMPLETED, update status only on DENIED/REFUNDED — is unit-testable without a
 * live Postgres, PayPal credentials, or a running Next server. The route handler
 * in `app/api/webhooks/paypal/route.ts` is a thin adapter over this.
 */

/** The five headers PayPal signs a webhook with. All are required to verify. */
export interface PayPalSignatureHeaders {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
}

/** Anything with a `Headers`-shaped getter (the Fetch `Headers` object fits). */
export interface HeaderReader {
  get(name: string): string | null;
}

/** Pull the signature headers, or null when any one is missing/blank. */
export function readSignatureHeaders(
  headers: HeaderReader,
): PayPalSignatureHeaders | null {
  const read = (name: string) => headers.get(name)?.trim() || null;
  const authAlgo = read("paypal-auth-algo");
  const certUrl = read("paypal-cert-url");
  const transmissionId = read("paypal-transmission-id");
  const transmissionSig = read("paypal-transmission-sig");
  const transmissionTime = read("paypal-transmission-time");
  if (
    !authAlgo ||
    !certUrl ||
    !transmissionId ||
    !transmissionSig ||
    !transmissionTime
  ) {
    return null;
  }
  return { authAlgo, certUrl, transmissionId, transmissionSig, transmissionTime };
}

/**
 * The verify-webhook-signature request as the exact bytes to send (launch fix
 * M8). PayPal verifies the signature against the event **as it was
 * transmitted**; parsing the body and serialising it again can change
 * whitespace, unicode escapes and number formatting, and a buyer whose name
 * carries an accent would then fail verification for days of retries. So the
 * raw body is spliced into the request untouched, and only the five header
 * values and the webhook id are serialised here.
 */
export function verificationBody(
  headers: PayPalSignatureHeaders,
  webhookId: string,
  rawBody: string,
): string {
  const fields = {
    auth_algo: headers.authAlgo,
    cert_url: headers.certUrl,
    transmission_id: headers.transmissionId,
    transmission_sig: headers.transmissionSig,
    transmission_time: headers.transmissionTime,
    webhook_id: webhookId,
  };
  const head = JSON.stringify(fields);
  return `${head.slice(0, -1)},"webhook_event":${rawBody.trim()}}`;
}

/** The verify request as an object. Kept for callers that log or inspect it; the route sends {@link verificationBody}. */
export function verificationPayload(
  headers: PayPalSignatureHeaders,
  webhookId: string,
  event: unknown,
): Record<string, unknown> {
  return {
    auth_algo: headers.authAlgo,
    cert_url: headers.certUrl,
    transmission_id: headers.transmissionId,
    transmission_sig: headers.transmissionSig,
    transmission_time: headers.transmissionTime,
    webhook_id: webhookId,
    webhook_event: event,
  };
}

/** PayPal replies `{ verification_status: "SUCCESS" | "FAILURE" }`. */
export function isVerificationSuccess(response: unknown): boolean {
  return (
    typeof response === "object" &&
    response !== null &&
    (response as { verification_status?: unknown }).verification_status ===
      "SUCCESS"
  );
}

export const HANDLED_EVENT_TYPES = [
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.REFUNDED",
  // A chargeback or dispute PayPal decided against us (launch fix M10). The
  // money is gone in full, so it is recorded exactly as a full refund: the
  // payment goes `refunded`, which arms "Reverse this refund" on
  // /admin/payments, and the event type stays in the payload for the admin.
  "PAYMENT.CAPTURE.REVERSED",
] as const;

export type HandledEventType = (typeof HANDLED_EVENT_TYPES)[number];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** `/v2/checkout/orders/{id}` out of a resource's HATEOAS links. */
function orderIdFromLinks(resource: Record<string, unknown>): string | null {
  const links = resource.links;
  if (!Array.isArray(links)) return null;
  for (const link of links) {
    if (!isRecord(link)) continue;
    const href = str(link.href);
    const match = href?.match(/\/v2\/checkout\/orders\/([^/?#]+)/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Which payment an event points at. The order id is the primary key into
 * `payments`; the capture id is the fallback for `PAYMENT.CAPTURE.REFUNDED`,
 * whose `resource` is a *refund* (so `resource.id` is the refund id, not the
 * capture) and which does not always carry the order id.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function paymentRefFromEvent(event: unknown): PaymentRef {
  if (!isRecord(event) || !isRecord(event.resource)) return {};
  const resource = event.resource;
  // Our own payment id rides along as `custom_id` on every order we create
  // (M11). Only a well-formed uuid is trusted; anything else is not ours.
  const customId = str(resource.custom_id);
  const paymentId = customId && UUID.test(customId) ? customId : null;
  const related = isRecord(resource.supplementary_data)
    ? isRecord(resource.supplementary_data.related_ids)
      ? resource.supplementary_data.related_ids
      : null
    : null;

  const isRefund = str(event.event_type) === "PAYMENT.CAPTURE.REFUNDED";
  return {
    providerOrderId:
      (related ? str(related.order_id) : null) ?? orderIdFromLinks(resource),
    providerCaptureId: isRefund
      ? (related ? str(related.capture_id) : null)
      : ((related ? str(related.capture_id) : null) ?? str(resource.id)),
    ...(paymentId ? { paymentId } : {}),
  };
}

/**
 * How much of the capture has been refunded so far, as PayPal's 2-decimal
 * string, or null when the event doesn't say.
 *
 * `PAYMENT.CAPTURE.REFUNDED` fires for a partial refund exactly as it does for
 * a full one, and its `resource` is the *refund*: `resource.amount` is this
 * refund alone, while `seller_payable_breakdown.total_refunded_amount` is the
 * running total across every refund on the capture. The total is preferred, so
 * two partial refunds that add up to the whole payment read as a full refund on
 * the second event. Settlement compares it with `payments.amount_usd`
 * (`markStatus`); nothing here decides what "full" means.
 */
export function refundedTotalFromEvent(event: unknown): string | null {
  if (!isRecord(event) || !isRecord(event.resource)) return null;
  const resource = event.resource;
  const breakdown = isRecord(resource.seller_payable_breakdown)
    ? resource.seller_payable_breakdown
    : null;
  const total =
    breakdown && isRecord(breakdown.total_refunded_amount)
      ? str(breakdown.total_refunded_amount.value)
      : null;
  const own = isRecord(resource.amount) ? str(resource.amount.value) : null;
  return total ?? own;
}

export interface WebhookDeps {
  /** `PAYPAL_WEBHOOK_ID`; null/blank means the server cannot verify anything. */
  webhookId: string | null;
  /** Calls PayPal's verify-webhook-signature endpoint. */
  verifySignature(input: {
    headers: PayPalSignatureHeaders;
    webhookId: string;
    event: unknown;
    /** The body exactly as PayPal sent it; what the signature covers (M8). */
    rawBody: string;
  }): Promise<boolean>;
  settleCapturedOrder(ref: PaymentRef & { rawPayload?: unknown }): Promise<SettleResult>;
  markPaymentStatus(
    ref: PaymentRef & {
      status: "failed" | "refunded";
      refundedUsd?: string;
      rawPayload?: unknown;
    },
  ): Promise<MarkResult>;
}

export interface WebhookResponse {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Handle one webhook delivery. `rawBody` is the exact bytes PayPal sent — the
 * signature covers them, so it is parsed here and never re-read from a framework
 * helper that might normalise it.
 *
 * Status choices:
 *  - **400** — malformed body, missing signature headers, or a signature PayPal
 *    will not vouch for. Nothing is processed. An unverified event is indis-
 *    tinguishable from a forgery, and a forged `PAYMENT.CAPTURE.COMPLETED` mints
 *    free credits, so this check precedes every read and write.
 *  - **503** — `PAYPAL_WEBHOOK_ID` is unset. A misconfigured server should have
 *    the delivery *retried* once configured, not permanently discarded, so this
 *    is deliberately not the 400 above (docs/DECISIONS.md).
 *  - **200** — verified. Includes event types we don't handle and events for
 *    orders we have no record of: both are final, and a retry would not change
 *    the outcome.
 */
export async function handlePayPalWebhook(
  rawBody: string,
  headers: HeaderReader,
  deps: WebhookDeps,
): Promise<WebhookResponse> {
  const webhookId = deps.webhookId?.trim();
  if (!webhookId) {
    return {
      status: 503,
      body: { error: "PayPal webhook verification is not configured." },
    };
  }

  const signature = readSignatureHeaders(headers);
  if (!signature) {
    return { status: 400, body: { error: "Missing PayPal signature headers." } };
  }

  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: "Malformed webhook body." } };
  }
  if (!isRecord(event)) {
    return { status: 400, body: { error: "Malformed webhook body." } };
  }

  const verified = await deps.verifySignature({
    headers: signature,
    webhookId,
    event,
    rawBody,
  });
  if (!verified) {
    // Not processed: no lookup, no status change, no credit.
    return { status: 400, body: { error: "Webhook signature verification failed." } };
  }

  const eventType = str(event.event_type);
  if (!eventType || !HANDLED_EVENT_TYPES.includes(eventType as HandledEventType)) {
    return { status: 200, body: { received: true, handled: false } };
  }

  const ref = paymentRefFromEvent(event);
  if (!ref.providerOrderId && !ref.providerCaptureId && !ref.paymentId) {
    return { status: 200, body: { received: true, result: "unidentifiable" } };
  }

  if (eventType === "PAYMENT.CAPTURE.COMPLETED") {
    // The same call, with the same reference_id, the client capture makes.
    const result = await deps.settleCapturedOrder({ ...ref, rawPayload: event });
    return { status: 200, body: { received: true, result: result.status } };
  }

  if (eventType === "PAYMENT.CAPTURE.DENIED") {
    const result = await deps.markPaymentStatus({ ...ref, status: "failed", rawPayload: event });
    return { status: 200, body: { received: true, result: result.status } };
  }

  if (eventType === "PAYMENT.CAPTURE.REVERSED") {
    // M10: a chargeback is a refund PayPal made for us, in full. The capture
    // resource's own amount is the whole payment, so `markStatus` never reads
    // it as partial; the event type stays in the payload for the admin.
    const result = await deps.markPaymentStatus({ ...ref, status: "refunded", rawPayload: event });
    return { status: 200, body: { received: true, result: result.status } };
  }

  // REFUNDED. The amount goes with it: a partial refund must not be recorded as
  // a refunded payment (see `markStatus`).
  const refundedUsd = refundedTotalFromEvent(event);
  const result = await deps.markPaymentStatus({
    ...ref,
    status: "refunded",
    ...(refundedUsd === null ? {} : { refundedUsd }),
    rawPayload: event,
  });
  return { status: 200, body: { received: true, result: result.status } };
}
