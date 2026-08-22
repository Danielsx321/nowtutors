import { describe, it, expect } from "vitest";
import {
  settleCapture,
  type PaymentPatch,
  type PaymentRecord,
  type PaymentRef,
  type PaymentStore,
} from "@/lib/paypal/settlement";
import type { LedgerExecutor } from "@/lib/credits/ledger";
import { InMemoryLedger } from "./helpers/in-memory-ledger";

/**
 * Booking direct-pay settlement (SPEC §7.6, §7.3 step 4b).
 *
 * Direct-pay is **buy-then-spend in one checkout**: the order mints exactly the
 * credits the booking costs, immediately spends them, and flips the booking to
 * confirmed. Net wallet effect is zero — the student never held these credits.
 *
 * The assertion that matters is the client-capture/webhook race: the booking
 * must reach `confirmed` **exactly once**, with exactly one `purchase` row and
 * one `booking_debit` row, each guarded independently by the existing
 * `(type, reference_id)` unique index (§4.4). No new idempotency machinery.
 */

const PAYMENT_ID = "22222222-2222-4222-8222-222222222222";
const BOOKING_ID = "33333333-3333-4333-8333-333333333333";
const ORDER_ID = "5O190127TN364715T";
const CAPTURE_ID = "3C679366HH908993F";

/** In-memory PaymentStore that also models the bookings row. */
class InMemoryPayments implements PaymentStore {
  readonly ledger: InMemoryLedger;
  rows = new Map<string, PaymentRecord>();
  orderIds = new Map<string, string>();
  patches: Array<{ paymentId: string; patch: PaymentPatch }> = [];
  /** bookingId → status. */
  bookings = new Map<string, string>();
  /** Every confirmBooking call and whether it moved the row. */
  confirmCalls: boolean[] = [];

  constructor(ledger: InMemoryLedger, seed: PaymentRecord[] = []) {
    this.ledger = ledger;
    for (const row of seed) this.rows.set(row.id, { ...row });
  }

  async lock(ref: PaymentRef): Promise<PaymentRecord | null> {
    const orderId = ref.providerOrderId?.trim();
    const captureId = ref.providerCaptureId?.trim();
    for (const row of this.rows.values()) {
      if (orderId && this.orderIds.get(row.id) === orderId) return { ...row };
      if (captureId && row.providerCaptureId === captureId) return { ...row };
    }
    return null;
  }

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
  }

  savepoint<T>(fn: (ledger: LedgerExecutor) => Promise<T>): Promise<T> {
    return this.ledger.transaction(() => fn(this.ledger));
  }

  /** Conditional on pending_payment — exactly what the SQL UPDATE does. */
  async confirmBooking(bookingId: string): Promise<boolean> {
    const moved = this.bookings.get(bookingId) === "pending_payment";
    if (moved) this.bookings.set(bookingId, "confirmed");
    this.confirmCalls.push(moved);
    return moved;
  }
}

function bookingPayment(over: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: PAYMENT_ID,
    userId: "alice",
    purpose: "booking",
    status: "created",
    // For direct-pay this is the amount the checkout mints and then spends.
    creditsGranted: 20,
    amountUsd: "26.66",
    currency: "USD",
    providerCaptureId: null,
    capturedAt: null,
    bookingId: BOOKING_ID,
    ...over,
  };
}

function store(seed: PaymentRecord, balances: Record<string, number> = {}) {
  const s = new InMemoryPayments(new InMemoryLedger(balances), [seed]);
  s.orderIds.set(seed.id, ORDER_ID);
  s.bookings.set(BOOKING_ID, "pending_payment");
  return s;
}

describe("direct-pay settlement — mint, spend, confirm in one transaction", () => {
  it("credits the price, debits it back, and confirms the booking", async () => {
    const s = store(bookingPayment(), { alice: 7 });

    const result = await settleCapture(s, {
      providerOrderId: ORDER_ID,
      providerCaptureId: CAPTURE_ID,
      rawPayload: { id: ORDER_ID },
    });

    expect(result).toMatchObject({
      status: "booking_confirmed",
      paymentId: PAYMENT_ID,
      bookingId: BOOKING_ID,
    });

    expect(s.rows.get(PAYMENT_ID)).toMatchObject({
      status: "captured",
      providerCaptureId: CAPTURE_ID,
    });
    expect(s.bookings.get(BOOKING_ID)).toBe("confirmed");

    // Two ledger rows: the mint and the spend.
    expect(s.ledger.rows).toHaveLength(2);
    expect(s.ledger.rows[0]).toMatchObject({
      delta: 20,
      type: "purchase",
      referenceType: "payment",
      referenceId: PAYMENT_ID,
    });
    expect(s.ledger.rows[1]).toMatchObject({
      delta: -20,
      type: "booking_debit",
      referenceType: "booking",
      referenceId: BOOKING_ID,
    });

    // Net wallet effect is zero — the student never held these credits.
    expect(s.ledger.balances.get("alice")).toBe(7);
  });

  it("works for a first-time buyer with no wallet row", async () => {
    const s = store(bookingPayment());
    const result = await settleCapture(s, { providerOrderId: ORDER_ID });
    expect(result.status).toBe("booking_confirmed");
    expect(s.ledger.balances.get("alice")).toBe(0);
    expect(s.ledger.rows).toHaveLength(2);
  });
});

describe("direct-pay settlement — the client/webhook race confirms exactly once", () => {
  it("confirms once when the webhook follows the client capture", async () => {
    const s = store(bookingPayment(), { alice: 5 });

    const first = await settleCapture(s, {
      providerOrderId: ORDER_ID,
      providerCaptureId: CAPTURE_ID,
    });
    // Same order, same payment, same reference ids — the webhook backstop.
    const second = await settleCapture(s, {
      providerOrderId: ORDER_ID,
      providerCaptureId: CAPTURE_ID,
    });

    expect(first.status).toBe("booking_confirmed");
    expect(second).toMatchObject({
      status: "booking_already_confirmed",
      bookingId: BOOKING_ID,
    });

    // Exactly one of the two calls moved the booking.
    expect(s.confirmCalls.filter(Boolean)).toHaveLength(1);
    expect(s.bookings.get(BOOKING_ID)).toBe("confirmed");

    // Still exactly one mint and one spend — the unique index absorbed the
    // replay on each leg independently.
    expect(s.ledger.rows).toHaveLength(2);
    expect(s.ledger.balances.get("alice")).toBe(5);
  });

  it("confirms once when the client capture follows the webhook", async () => {
    const s = store(bookingPayment());
    await settleCapture(s, { providerOrderId: ORDER_ID, providerCaptureId: CAPTURE_ID });
    // Matched by capture id alone the second time.
    const second = await settleCapture(s, { providerCaptureId: CAPTURE_ID });

    expect(second.status).toBe("booking_already_confirmed");
    expect(s.ledger.rows).toHaveLength(2);
    expect(s.bookings.get(BOOKING_ID)).toBe("confirmed");
  });

  it("ten replays still confirm once and move the balance once", async () => {
    const s = store(bookingPayment(), { alice: 3 });
    const results = [];
    for (let i = 0; i < 10; i++) {
      results.push(await settleCapture(s, { providerOrderId: ORDER_ID }));
    }

    expect(results.filter((r) => r.status === "booking_confirmed")).toHaveLength(1);
    expect(
      results.filter((r) => r.status === "booking_already_confirmed"),
    ).toHaveLength(9);
    expect(s.ledger.rows).toHaveLength(2);
    expect(s.ledger.balances.get("alice")).toBe(3);
    expect(s.confirmCalls.filter(Boolean)).toHaveLength(1);
  });

  it("keeps the payments update after the duplicate legs are rejected", async () => {
    // The savepoints are what make this true: the unique violations unwind only
    // the ledger appends, leaving the outer transaction usable.
    const s = store(bookingPayment());
    await settleCapture(s, { providerOrderId: ORDER_ID });
    await settleCapture(s, { providerOrderId: ORDER_ID, providerCaptureId: CAPTURE_ID });

    expect(s.rows.get(PAYMENT_ID)).toMatchObject({
      status: "captured",
      providerCaptureId: CAPTURE_ID,
    });
    expect(s.ledger.aborted).toBe(false);
  });
});

describe("direct-pay settlement — nothing to settle is not a confirmation", () => {
  it("does not claim a confirmation when the payment carries no booking", async () => {
    const s = store(bookingPayment({ bookingId: null }));
    const result = await settleCapture(s, { providerOrderId: ORDER_ID });
    expect(result).toEqual({ status: "captured_no_credit", paymentId: PAYMENT_ID });
    expect(s.ledger.rows).toHaveLength(0);
    expect(s.bookings.get(BOOKING_ID)).toBe("pending_payment");
  });

  it("does not settle a zero-credit booking payment", async () => {
    const s = store(bookingPayment({ creditsGranted: 0 }));
    const result = await settleCapture(s, { providerOrderId: ORDER_ID });
    expect(result).toEqual({ status: "captured_no_credit", paymentId: PAYMENT_ID });
    expect(s.ledger.rows).toHaveLength(0);
  });

  it("a refunded direct-pay payment is not resurrected by a late COMPLETED", async () => {
    const s = store(bookingPayment({ status: "refunded" }));
    await settleCapture(s, { providerOrderId: ORDER_ID });
    expect(s.rows.get(PAYMENT_ID)!.status).toBe("refunded"); // no status write
    expect(s.patches).toHaveLength(0);
  });

  it("a credit_purchase payment is untouched by the booking branch", async () => {
    const s = store(
      bookingPayment({ purpose: "credit_purchase", creditsGranted: 30, bookingId: null }),
    );
    const result = await settleCapture(s, { providerOrderId: ORDER_ID });
    expect(result.status).toBe("credited");
    // One row only: the purchase. No booking_debit on a plain credit purchase.
    expect(s.ledger.rows).toHaveLength(1);
    expect(s.ledger.rows[0].type).toBe("purchase");
    expect(s.confirmCalls).toHaveLength(0);
  });
});
