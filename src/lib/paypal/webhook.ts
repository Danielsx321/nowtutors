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

/** The request body PayPal's verify-webhook-signature endpoint expects. */
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
export function paymentRefFromEvent(event: unknown): PaymentRef {
  if (!isRecord(event) || !isRecord(event.resource)) return {};
  const resource = event.resource;
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
  };
}

export interface WebhookDeps {
  /** `PAYPAL_WEBHOOK_ID`; null/blank means the server cannot verify anything. */
  webhookId: string | null;
  /** Calls PayPal's verify-webhook-signature endpoint. */
  verifySignature(input: {
    headers: PayPalSignatureHeaders;
    webhookId: string;
    event: unknown;
  }): Promise<boolean>;
  settleCapturedOrder(ref: PaymentRef & { rawPayload?: unknown }): Promise<SettleResult>;
  markPaymentStatus(
    ref: PaymentRef & { status: "failed" | "refunded"; rawPayload?: unknown },
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
  if (!ref.providerOrderId && !ref.providerCaptureId) {
    return { status: 200, body: { received: true, result: "unidentifiable" } };
  }

  if (eventType === "PAYMENT.CAPTURE.COMPLETED") {
    // The same call, with the same reference_id, the client capture makes.
    const result = await deps.settleCapturedOrder({ ...ref, rawPayload: event });
    return { status: 200, body: { received: true, result: result.status } };
  }

  const result = await deps.markPaymentStatus({
    ...ref,
    status: eventType === "PAYMENT.CAPTURE.DENIED" ? "failed" : "refunded",
    rawPayload: event,
  });
  return { status: 200, body: { received: true, result: result.status } };
}
