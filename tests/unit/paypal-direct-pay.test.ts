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
 *
 * The second assertion that matters is what happens when the slot is gone by
 * the time the money lands: **a captured payment is always honoured**. The mint
 * is unconditional and the spend is gated on the confirm, so the student keeps
 * the credits rather than being charged for nothing. Because that leaves a
 * committed mint with no spend beside it, the replay guard reads both legs out
 * of the ledger instead of inferring one from the other.
 *
 * Settlement writes each ledger row exactly once and never returns to it —
 * `credit_transactions` is append-only without exception (§4.4). The
 * student-facing wording for a retained mint is derived on read; see
 * `tests/unit/retained-credits.test.ts`.
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

  /**
   * Set to model a **stale** first read — what a client/webhook race actually
   * produces, where the other settlement is a separate transaction that commits
   * between this one's probe and its insert. (The ledger fake is a single
   * transaction, so two truly concurrent `settleCapture` calls would share one
   * rollback snapshot and model nothing real; a stale read is the honest
   * reproduction.) Cleared once consumed.
   */
  staleLegsOnce = false;

  /** Reads both direct-pay legs straight out of the ledger, as the SQL does. */
  async settledLegs(paymentId: string, bookingId: string) {
    if (this.staleLegsOnce) {
      this.staleLegsOnce = false;
      return { minted: false, debited: false };
    }
    return {
      minted: this.ledger.rows.some(
        (r) => r.type === "purchase" && r.referenceId === paymentId,
      ),
      debited: this.ledger.rows.some(
        (r) => r.type === "booking_debit" && r.referenceId === bookingId,
      ),
    };
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

function store(
  seed: PaymentRecord,
  balances: Record<string, number> = {},
  bookingStatus = "pending_payment",
) {
  const s = new InMemoryPayments(new InMemoryLedger(balances), [seed]);
  s.orderIds.set(seed.id, ORDER_ID);
  s.bookings.set(BOOKING_ID, bookingStatus);
  return s;
}

/** The §12 sweep got there first: the slot was released before the money landed. */
function expiredStore(balances: Record<string, number> = {}) {
  return store(bookingPayment(), balances, "expired");
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

  it("keeps the payments update on the replay", async () => {
    // The replay is recognised from the ledger before any append is attempted,
    // so nothing is even offered to the unique index; and where a genuine race
    // does reach it (see the concurrent test below), the savepoint unwinds only
    // the append and leaves the outer transaction usable.
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

describe("direct-pay settlement — the slot is gone: honour the capture, keep the credits", () => {
  it("mints without debiting when the booking expired before the capture arrived", async () => {
    // The §12 sweep released the hold while the buyer was still on PayPal's
    // approval screen. The money is ours, so it must become something the
    // student holds: they lost the slot, not the payment. SPEC has no refund
    // path (§18 item 4), and this is the one outcome that needs none.
    const s = expiredStore({ alice: 4 });

    const result = await settleCapture(s, {
      providerOrderId: ORDER_ID,
      providerCaptureId: CAPTURE_ID,
    });

    expect(result).toEqual({
      status: "booking_unavailable_credits_retained",
      paymentId: PAYMENT_ID,
      bookingId: BOOKING_ID,
      credits: 20,
    });

    // The capture is still recorded — the money really was taken.
    expect(s.rows.get(PAYMENT_ID)).toMatchObject({
      status: "captured",
      providerCaptureId: CAPTURE_ID,
    });

    // The mint, and ONLY the mint. A debit here is the bug this replaces: it
    // would leave the student charged, holding no credits and no booking.
    expect(s.ledger.rows).toHaveLength(1);
    expect(s.ledger.rows[0]).toMatchObject({
      delta: 20,
      type: "purchase",
      referenceType: "payment",
      referenceId: PAYMENT_ID,
    });
    expect(
      s.ledger.rows.some((r) => r.type === "booking_debit"),
    ).toBe(false);

    // Balance up by exactly the minted credits, and the booking left alone.
    expect(s.ledger.balances.get("alice")).toBe(24);
    expect(s.bookings.get(BOOKING_ID)).toBe("expired");
  });

  it("appends the mint once with the ordinary purchase wording and never rewrites it", async () => {
    // The student-facing "credits retained" wording is NOT written here. It is
    // derived on read (tests/unit/retained-credits.test.ts) from the missing
    // booking_debit, because credit_transactions is append-only without
    // exception (§4.4) — settlement gets no UPDATE path to make a row read
    // better after the fact.
    const s = expiredStore();
    await settleCapture(s, { providerOrderId: ORDER_ID });

    expect(s.ledger.rows).toHaveLength(1);
    expect(s.ledger.rows[0].description).toBe(
      "Credit purchase — 20 credits ($26.66 USD)",
    );
  });

  it("reaches no UPDATE path on credit_transactions", async () => {
    // The invariant, asserted where it could plausibly be broken: settlement is
    // the one caller that ever wanted to amend a row. Rows are frozen on
    // insert, so an in-place rewrite would have thrown during the settlement
    // above rather than passing quietly...
    const s = expiredStore({ alice: 4 });
    await settleCapture(s, { providerOrderId: ORDER_ID });
    expect(Object.isFrozen(s.ledger.rows[0])).toBe(true);

    // ...and the ledger executor exposes no UPDATE method for it to call. This
    // tripwire only fires if one is reintroduced; that it is never hit during
    // any settlement in this file is the assertion that matters.
    await expect(s.ledger.setDescription()).rejects.toThrow(/append-only/i);

    // Untouched by everything above: the row as first appended.
    expect(s.ledger.rows[0]).toMatchObject({
      delta: 20,
      type: "purchase",
      description: "Credit purchase — 20 credits ($26.66 USD)",
    });
  });

  it("does not confirm anything on a booking that is already gone", async () => {
    const s = expiredStore();
    await settleCapture(s, { providerOrderId: ORDER_ID });
    // The confirm was attempted exactly once and moved nothing — the row is
    // not `pending_payment`, so the conditional UPDATE matched zero rows.
    expect(s.confirmCalls).toEqual([false]);
    expect(s.bookings.get(BOOKING_ID)).toBe("expired");
  });
});

describe("direct-pay settlement — the replay guard reads the ledger, not the ordering", () => {
  it("replays case (a) — mint, confirm, debit — as a no-op", async () => {
    const s = store(bookingPayment(), { alice: 9 });
    const first = await settleCapture(s, { providerOrderId: ORDER_ID });
    const second = await settleCapture(s, { providerOrderId: ORDER_ID });

    expect(first.status).toBe("booking_confirmed");
    // Both legs are in the ledger, so the replay knows the booking was
    // confirmed and says exactly that.
    expect(second).toEqual({
      status: "booking_already_confirmed",
      paymentId: PAYMENT_ID,
      bookingId: BOOKING_ID,
    });
    expect(s.ledger.rows).toHaveLength(2);
    expect(s.ledger.balances.get("alice")).toBe(9);
  });

  it("replays case (b) — mint, failed confirm, no debit — without debiting", async () => {
    // The dangerous replay. A committed mint with no debit beside it is now a
    // legitimate resting state, so "already minted" must NOT be read as
    // "already fully settled, skip everything" *or* as "the debit is missing,
    // go finish the job". The credits are the student's; a retried webhook
    // must not quietly take them back.
    const s = expiredStore({ alice: 4 });
    const first = await settleCapture(s, { providerOrderId: ORDER_ID });
    const second = await settleCapture(s, { providerOrderId: ORDER_ID });

    expect(first.status).toBe("booking_unavailable_credits_retained");
    expect(second).toEqual({
      status: "booking_unavailable_credits_retained",
      paymentId: PAYMENT_ID,
      bookingId: BOOKING_ID,
      credits: 20,
    });

    expect(s.ledger.rows).toHaveLength(1);
    expect(s.ledger.rows[0].type).toBe("purchase");
    expect(s.ledger.balances.get("alice")).toBe(24); // unchanged by the replay
  });

  it("ten replays of case (b) neither re-mint nor ever debit", async () => {
    const s = expiredStore({ alice: 4 });
    const results = [];
    for (let i = 0; i < 10; i++) {
      results.push(await settleCapture(s, { providerOrderId: ORDER_ID }));
    }
    expect(
      results.every((r) => r.status === "booking_unavailable_credits_retained"),
    ).toBe(true);
    expect(s.ledger.rows).toHaveLength(1);
    expect(s.ledger.balances.get("alice")).toBe(24);
  });

  it("does not retroactively debit a case (b) booking that became confirmable again", async () => {
    // Nothing in SPEC puts an `expired` booking back to `pending_payment`, but
    // if anything ever did, the replay must still not spend credits the
    // student has been told are theirs. The money question was settled when
    // the capture was honoured; a later replay does not reopen it.
    const s = expiredStore({ alice: 4 });
    await settleCapture(s, { providerOrderId: ORDER_ID });

    s.bookings.set(BOOKING_ID, "pending_payment"); // somehow confirmable again
    const replay = await settleCapture(s, { providerOrderId: ORDER_ID });

    expect(replay.status).toBe("booking_unavailable_credits_retained");
    expect(s.ledger.rows).toHaveLength(1);
    expect(s.ledger.balances.get("alice")).toBe(24);
    // The confirm was never even attempted a second time.
    expect(s.confirmCalls).toEqual([false]);
    expect(s.bookings.get(BOOKING_ID)).toBe("pending_payment");
  });

  it("lands exactly one mint when the client and the webhook race on a gone slot", async () => {
    // The race, as it actually reaches the database: the loser probes the
    // ledger before the winner's transaction commits, so its read says
    // "nothing minted" and it tries to mint too. The `(type, reference_id)`
    // unique index — not the read — is the guard that holds. The loser must
    // absorb the rejection, re-read, and report the same retained-credits
    // outcome rather than raising or minting twice.
    const s = expiredStore({ alice: 4 });

    const first = await settleCapture(s, {
      providerOrderId: ORDER_ID,
      providerCaptureId: CAPTURE_ID,
    });
    expect(first.status).toBe("booking_unavailable_credits_retained");

    s.staleLegsOnce = true; // the loser's probe predates the winner's commit
    const second = await settleCapture(s, { providerCaptureId: CAPTURE_ID });

    expect(second).toEqual({
      status: "booking_unavailable_credits_retained",
      paymentId: PAYMENT_ID,
      bookingId: BOOKING_ID,
      credits: 20,
    });

    // One mint, no debit, credited exactly once.
    expect(s.ledger.rows).toHaveLength(1);
    expect(s.ledger.rows[0].type).toBe("purchase");
    expect(s.ledger.balances.get("alice")).toBe(24);
    // The savepoint unwound the duplicate append and nothing else.
    expect(s.ledger.aborted).toBe(false);
    // And the loser never went on to confirm or debit.
    expect(s.confirmCalls).toEqual([false]);
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
