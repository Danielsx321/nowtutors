import { describe, it, expect } from "vitest";
import {
  markStatus,
  settleCapture,
  type PaymentPatch,
  type PaymentRecord,
  type PaymentRef,
  type PaymentStore,
} from "@/lib/paypal/settlement";
import type { LedgerExecutor } from "@/lib/credits/ledger";
import { InMemoryLedger } from "./helpers/in-memory-ledger";

/**
 * The PayPal capture→credit path (SPEC §7.6), driven against in-memory storage.
 * The scenario that matters is the client capture and the
 * `PAYMENT.CAPTURE.COMPLETED` webhook both firing for one order: it must credit
 * exactly once, via the `(type, reference_id)` unique index and nothing else.
 */

/** In-memory {@link PaymentStore} over the shared ledger fake. */
class InMemoryPayments implements PaymentStore {
  readonly ledger: InMemoryLedger;
  rows = new Map<string, PaymentRecord>();
  /** Every patch applied, in order — lets a test assert what was written. */
  patches: Array<{ paymentId: string; patch: PaymentPatch }> = [];
  lockCount = 0;

  constructor(ledger: InMemoryLedger, seed: PaymentRecord[] = []) {
    this.ledger = ledger;
    for (const row of seed) this.rows.set(row.id, { ...row });
  }

  async lock(ref: PaymentRef): Promise<PaymentRecord | null> {
    this.lockCount++;
    const orderId = ref.providerOrderId?.trim();
    const captureId = ref.providerCaptureId?.trim();
    const paymentId = ref.paymentId?.trim();
    for (const row of this.rows.values()) {
      if (orderId && this.orderIds.get(row.id) === orderId) return this.record(row);
      if (captureId && row.providerCaptureId === captureId) return this.record(row);
      if (paymentId && row.id === paymentId) return this.record(row);
    }
    return null;
  }

  private record(row: PaymentRecord): PaymentRecord {
    return { ...row, providerOrderId: this.orderIds.get(row.id) ?? null };
  }

  /** payments.provider_order_id, kept beside the record the store returns. */
  orderIds = new Map<string, string>();

  async update(paymentId: string, patch: PaymentPatch): Promise<void> {
    this.patches.push({ paymentId, patch });
    const row = this.rows.get(paymentId);
    if (!row) throw new Error(`no payment ${paymentId}`);
    this.rows.set(paymentId, {
      ...row,
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.providerCaptureId === undefined
        ? {}
        : { providerCaptureId: patch.providerCaptureId }),
      ...(patch.capturedAt === undefined ? {} : { capturedAt: patch.capturedAt }),
    });
    if (patch.providerOrderId !== undefined) this.orderIds.set(paymentId, patch.providerOrderId);
  }

  /** SAVEPOINT: rolls back only `fn` on throw, leaving the outer tx usable. */
  savepoint<T>(fn: (ledger: LedgerExecutor) => Promise<T>): Promise<T> {
    return this.ledger.transaction(() => fn(this.ledger));
  }
}

const PAYMENT_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "5O190127TN364715T";
const CAPTURE_ID = "3C679366HH908993F";

function purchase(over: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: PAYMENT_ID,
    userId: "alice",
    purpose: "credit_purchase",
    status: "created",
    creditsGranted: 30,
    amountUsd: "39.99",
    currency: "USD",
    providerCaptureId: null,
    capturedAt: null,
    ...over,
  };
}

function store(seed: PaymentRecord, balances: Record<string, number> = {}) {
  const s = new InMemoryPayments(new InMemoryLedger(balances), [seed]);
  s.orderIds.set(seed.id, ORDER_ID);
  return s;
}

describe("settleCapture — the happy path", () => {
  it("marks the payment captured and credits the package once", async () => {
    const s = store(purchase(), { alice: 10 });

    const result = await settleCapture(s, {
      providerOrderId: ORDER_ID,
      providerCaptureId: CAPTURE_ID,
      rawPayload: { id: ORDER_ID },
    });

    expect(result).toMatchObject({
      status: "credited",
      paymentId: PAYMENT_ID,
      credits: 30,
      balanceAfter: 40,
    });
    expect(s.rows.get(PAYMENT_ID)).toMatchObject({
      status: "captured",
      providerCaptureId: CAPTURE_ID,
    });
    expect(s.rows.get(PAYMENT_ID)!.capturedAt).toBeInstanceOf(Date);
    expect(s.ledger.balances.get("alice")).toBe(40);
    expect(s.ledger.rows).toHaveLength(1);
  });

  it("references the payment id, so both capture paths collide on it", async () => {
    const s = store(purchase());
    await settleCapture(s, { providerOrderId: ORDER_ID, providerCaptureId: CAPTURE_ID });
    expect(s.ledger.rows[0]).toMatchObject({
      userId: "alice",
      delta: 30,
      balanceAfter: 30,
      type: "purchase",
      referenceType: "payment",
      referenceId: PAYMENT_ID,
    });
    expect(s.ledger.rows[0].description).toContain("30 credits");
  });

  it("opens a wallet for a first-time buyer", async () => {
    const s = store(purchase());
    const result = await settleCapture(s, { providerOrderId: ORDER_ID });
    expect(result).toMatchObject({ status: "credited", balanceAfter: 30 });
    expect(s.ledger.balances.get("alice")).toBe(30);
  });

  it("returns unknown_order for an order we never opened", async () => {
    const s = store(purchase());
    const result = await settleCapture(s, { providerOrderId: "NOT-OURS" });
    expect(result).toEqual({ status: "unknown_order" });
    expect(s.ledger.rows).toHaveLength(0);
    expect(s.patches).toHaveLength(0);
  });

  it("does not credit a booking direct-pay (Phase 5 Part 2)", async () => {
    const s = store(purchase({ purpose: "booking", creditsGranted: null }));
    const result = await settleCapture(s, { providerOrderId: ORDER_ID });
    expect(result).toEqual({ status: "captured_no_credit", paymentId: PAYMENT_ID });
    expect(s.rows.get(PAYMENT_ID)!.status).toBe("captured");
    expect(s.ledger.rows).toHaveLength(0);
  });
});

describe("settleCapture — duplicate capture (client + webhook both fire)", () => {
  it("credits once when the webhook follows the client capture", async () => {
    const s = store(purchase(), { alice: 10 });

    const first = await settleCapture(s, {
      providerOrderId: ORDER_ID,
      providerCaptureId: CAPTURE_ID,
    });
    // Same order, same payment, same reference_id — the webhook backstop.
    const second = await settleCapture(s, {
      providerOrderId: ORDER_ID,
      providerCaptureId: CAPTURE_ID,
    });

    expect(first.status).toBe("credited");
    expect(second).toEqual({
      status: "already_credited",
      paymentId: PAYMENT_ID,
      credits: 30,
    });
    expect(s.ledger.balances.get("alice")).toBe(40); // 10 + 30, credited once
    expect(s.ledger.rows).toHaveLength(1);
  });

  it("credits once when the client capture follows the webhook", async () => {
    const s = store(purchase());
    await settleCapture(s, { providerOrderId: ORDER_ID, providerCaptureId: CAPTURE_ID });
    // The client's own capture arrives second; the payment row is already
    // `captured`, so it is matched here by capture id alone.
    const second = await settleCapture(s, { providerCaptureId: CAPTURE_ID });
    expect(second.status).toBe("already_credited");
    expect(s.ledger.rows).toHaveLength(1);
    expect(s.ledger.balances.get("alice")).toBe(30);
  });

  it("keeps the payments update after the duplicate is rejected", async () => {
    // The savepoint is what makes this true: the unique violation aborts the
    // ledger append, and *only* the ledger append. Without it the whole
    // transaction would be poisoned and the status update rolled back with it.
    const s = store(purchase());
    await settleCapture(s, { providerOrderId: ORDER_ID });
    await settleCapture(s, { providerOrderId: ORDER_ID, providerCaptureId: CAPTURE_ID });

    expect(s.rows.get(PAYMENT_ID)).toMatchObject({
      status: "captured",
      providerCaptureId: CAPTURE_ID,
    });
    expect(s.ledger.aborted).toBe(false); // savepoint unwound the failure
  });

  it("ten replays of the same event still credit exactly once", async () => {
    const s = store(purchase(), { alice: 5 });
    const results = [];
    for (let i = 0; i < 10; i++) {
      results.push(await settleCapture(s, { providerOrderId: ORDER_ID }));
    }
    expect(results.filter((r) => r.status === "credited")).toHaveLength(1);
    expect(results.filter((r) => r.status === "already_credited")).toHaveLength(9);
    expect(s.ledger.balances.get("alice")).toBe(35);
    expect(s.ledger.rows).toHaveLength(1);
  });

  it("M4: a late COMPLETED on a refunded payment writes nothing and credits nothing", async () => {
    // The money went back to the buyer, so there is nothing to mint. The old
    // behaviour skipped only the status write and credited the wallet in full.
    const s = store(purchase({ status: "refunded" }), { alice: 5 });
    const result = await settleCapture(s, { providerOrderId: ORDER_ID, providerCaptureId: CAPTURE_ID });
    expect(result).toEqual({ status: "refunded_not_credited", paymentId: PAYMENT_ID });
    expect(s.rows.get(PAYMENT_ID)!.status).toBe("refunded");
    expect(s.patches).toHaveLength(0);
    expect(s.ledger.rows).toHaveLength(0);
    expect(s.ledger.balances.get("alice")).toBe(5);
  });

  it("M4: the same holds for a refunded direct-pay booking payment", async () => {
    const s = store(purchase({ status: "refunded", purpose: "booking", bookingId: "b1" }), { alice: 0 });
    const result = await settleCapture(s, { providerOrderId: ORDER_ID });
    expect(result.status).toBe("refunded_not_credited");
    expect(s.ledger.rows).toHaveLength(0);
  });

  it("M11: a row whose order id was never stamped is found by our own id, and stamped now", async () => {
    const s = store(purchase());
    s.orderIds.set(PAYMENT_ID, `pending:${PAYMENT_ID}`); // the process died before the stamp
    expect(await settleCapture(s, { providerOrderId: ORDER_ID })).toEqual({ status: "unknown_order" });

    const result = await settleCapture(s, {
      providerOrderId: ORDER_ID,
      providerCaptureId: CAPTURE_ID,
      paymentId: PAYMENT_ID,
    });
    expect(result.status).toBe("credited");
    expect(s.orderIds.get(PAYMENT_ID)).toBe(ORDER_ID);
    // And from now on the order id alone finds it, as for any other payment.
    expect((await settleCapture(s, { providerOrderId: ORDER_ID })).status).toBe("already_credited");
  });

  it("M11: a stamped order id is never overwritten by a later event", async () => {
    const s = store(purchase());
    await settleCapture(s, { providerOrderId: ORDER_ID, paymentId: PAYMENT_ID });
    await settleCapture(s, { providerOrderId: "SOMEONE-ELSES-ORDER", paymentId: PAYMENT_ID });
    expect(s.orderIds.get(PAYMENT_ID)).toBe(ORDER_ID);
  });
});

describe("markStatus — DENIED and REFUNDED never credit", () => {
  it("DENIED sets payments.status = failed and leaves the wallet alone", async () => {
    const s = store(purchase(), { alice: 12 });
    const result = await markStatus(s, {
      providerOrderId: ORDER_ID,
      providerCaptureId: CAPTURE_ID,
      status: "failed",
      rawPayload: { event_type: "PAYMENT.CAPTURE.DENIED" },
    });
    expect(result).toEqual({ status: "updated", paymentId: PAYMENT_ID });
    expect(s.rows.get(PAYMENT_ID)).toMatchObject({
      status: "failed",
      providerCaptureId: CAPTURE_ID,
    });
    expect(s.ledger.rows).toHaveLength(0);
    expect(s.ledger.balances.get("alice")).toBe(12);
  });

  it("REFUNDED sets payments.status = refunded without clawing credits back", async () => {
    // Reversing credits is an admin action (§18 item 4 — no automatic refunds),
    // not something a webhook does behind the student's back.
    const s = store(purchase({ status: "captured", providerCaptureId: CAPTURE_ID }), {
      alice: 40,
    });
    const result = await markStatus(s, {
      providerCaptureId: CAPTURE_ID,
      status: "refunded",
      rawPayload: { event_type: "PAYMENT.CAPTURE.REFUNDED" },
    });
    expect(result).toEqual({ status: "updated", paymentId: PAYMENT_ID });
    expect(s.rows.get(PAYMENT_ID)!.status).toBe("refunded");
    expect(s.ledger.rows).toHaveLength(0);
    expect(s.ledger.balances.get("alice")).toBe(40);
  });

  it("a FULL refund (refunded total covers the payment) marks it refunded", async () => {
    const s = store(purchase({ status: "captured", providerCaptureId: CAPTURE_ID }));
    const result = await markStatus(s, {
      providerCaptureId: CAPTURE_ID,
      status: "refunded",
      refundedUsd: "39.99",
    });
    expect(result).toEqual({ status: "updated", paymentId: PAYMENT_ID });
    expect(s.rows.get(PAYMENT_ID)!.status).toBe("refunded");
  });

  it("a PARTIAL refund does not mark the payment refunded (code review M5)", async () => {
    // `refunded` is what arms "Reverse this refund" on /admin/payments, which
    // takes back every minted credit or cancels the whole booking (§7.6). A $5
    // goodwill refund on a $39.99 package must not arm it.
    const s = store(purchase({ status: "captured", providerCaptureId: CAPTURE_ID }), {
      alice: 40,
    });
    const result = await markStatus(s, {
      providerCaptureId: CAPTURE_ID,
      status: "refunded",
      refundedUsd: "5.00",
      rawPayload: { event_type: "PAYMENT.CAPTURE.REFUNDED" },
    });
    expect(result).toEqual({
      status: "partial_refund",
      paymentId: PAYMENT_ID,
      refundedUsd: "5.00",
      amountUsd: "39.99",
    });
    expect(s.rows.get(PAYMENT_ID)!.status).toBe("captured");
    expect(s.ledger.rows).toHaveLength(0);
  });

  it("partial refunds that add up to the full amount mark it refunded", async () => {
    // PayPal reports the running total on each refund event.
    const s = store(purchase({ status: "captured", providerCaptureId: CAPTURE_ID }));
    await markStatus(s, { providerCaptureId: CAPTURE_ID, status: "refunded", refundedUsd: "20.00" });
    expect(s.rows.get(PAYMENT_ID)!.status).toBe("captured");
    await markStatus(s, { providerCaptureId: CAPTURE_ID, status: "refunded", refundedUsd: "39.99" });
    expect(s.rows.get(PAYMENT_ID)!.status).toBe("refunded");
  });

  it("returns unknown_order for a payment we don't hold", async () => {
    const s = store(purchase());
    const result = await markStatus(s, {
      providerOrderId: "NOT-OURS",
      status: "failed",
    });
    expect(result).toEqual({ status: "unknown_order" });
    expect(s.patches).toHaveLength(0);
  });
});
