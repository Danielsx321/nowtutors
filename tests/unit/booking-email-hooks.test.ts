import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Where the Part 2 emails are queued, and when they are NOT (SPEC §11):
 * PayPal settlement emails once per payment, a replayed DENIED or REFUNDED
 * sends nothing, an admin cancel emails the right sides. The builders are
 * mocked; what's under test is the dispatch.
 */

const m = vi.hoisted(() => ({
  queueEmails: vi.fn(),
  bookingConfirmedEmails: vi.fn(),
  creditsPurchasedEmails: vi.fn(),
  captureFailedEmails: vi.fn(),
  paypalRefundEmails: vi.fn(),
  bookingCancelledEmails: vi.fn(),
  sessionSummaryEmails: vi.fn(),
  applyForceComplete: vi.fn(),
  requireRole: vi.fn(),
  applyForceCancel: vi.fn(),
  applyRefundReversal: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/email", () => ({ queueEmails: (...a: unknown[]) => m.queueEmails(...a) }));
vi.mock("@/lib/email/booking-emails", () => ({
  bookingConfirmedEmails: (...a: unknown[]) => m.bookingConfirmedEmails(...a),
  creditsPurchasedEmails: (...a: unknown[]) => m.creditsPurchasedEmails(...a),
  captureFailedEmails: (...a: unknown[]) => m.captureFailedEmails(...a),
  paypalRefundEmails: (...a: unknown[]) => m.paypalRefundEmails(...a),
  bookingCancelledEmails: (...a: unknown[]) => m.bookingCancelledEmails(...a),
  sessionSummaryEmails: (...a: unknown[]) => m.sessionSummaryEmails(...a),
}));
vi.mock("@/db", () => ({ db: { transaction: (fn: (tx: unknown) => unknown) => fn("tx") } }));
vi.mock("@/lib/auth/guards", () => ({ requireRole: (...a: unknown[]) => m.requireRole(...a) }));
vi.mock("@/lib/settings", () => ({ getEarningsSettings: async () => ({}) }));
vi.mock("@/db/queries/admin-bookings", () => ({
  applyForceCancel: (...a: unknown[]) => m.applyForceCancel(...a),
  applyForceComplete: (...a: unknown[]) => m.applyForceComplete(...a),
  applyRefundReversal: (...a: unknown[]) => m.applyRefundReversal(...a),
}));

const { notifySettled, notifyMarked } = await import("@/lib/paypal/fulfilment");
const { forceCancelBooking, forceCompleteBooking, reverseRefundedPayment } = await import("@/actions/admin-bookings");

/** Run every queued builder, so the calls it made can be asserted. */
async function runQueued() {
  for (const [thunk] of m.queueEmails.mock.calls) await (thunk as () => Promise<unknown>)();
}

const BOOKING = "3f0c1b7e-0000-4000-8000-000000000001";
const PAYMENT = "8a1d2c3b-0000-4000-8000-000000000002";

beforeEach(() => {
  vi.clearAllMocks();
  m.requireRole.mockResolvedValue({ user: { id: "admin-1" } });
});

describe("PayPal settlement emails", () => {
  it("credited sends the receipt with the credited amount and balance", async () => {
    notifySettled({ status: "credited", paymentId: PAYMENT, credits: 30, balanceAfter: 70 });
    await runQueued();
    expect(m.creditsPurchasedEmails).toHaveBeenCalledWith(PAYMENT, { credits: 30, balanceAfter: 70 });
  });

  it("booking_confirmed sends the confirmation pair", async () => {
    notifySettled({ status: "booking_confirmed", paymentId: PAYMENT, bookingId: BOOKING });
    await runQueued();
    expect(m.bookingConfirmedEmails).toHaveBeenCalledWith(BOOKING);
  });

  it("the second caller's already_* results and the other outcomes send nothing", () => {
    notifySettled({ status: "already_credited", paymentId: PAYMENT, credits: 30 });
    notifySettled({ status: "booking_already_confirmed", paymentId: PAYMENT, bookingId: BOOKING });
    notifySettled({ status: "booking_unavailable_credits_retained", paymentId: PAYMENT, bookingId: BOOKING, credits: 40 });
    notifySettled({ status: "captured_no_credit", paymentId: PAYMENT });
    notifySettled({ status: "refunded_not_credited", paymentId: PAYMENT });
    notifySettled({ status: "unknown_order" });
    expect(m.queueEmails).not.toHaveBeenCalled();
  });

  it("a first DENIED alerts the admins; a replay does not", async () => {
    notifyMarked("failed", { status: "updated", paymentId: PAYMENT, previousStatus: "created" });
    await runQueued();
    expect(m.captureFailedEmails).toHaveBeenCalledWith(PAYMENT);

    vi.clearAllMocks();
    notifyMarked("failed", { status: "updated", paymentId: PAYMENT, previousStatus: "failed" });
    expect(m.queueEmails).not.toHaveBeenCalled();
  });

  it("a first full REFUNDED tells the payer; a replay or a partial refund does not", async () => {
    notifyMarked("refunded", { status: "updated", paymentId: PAYMENT, previousStatus: "captured" });
    await runQueued();
    expect(m.paypalRefundEmails).toHaveBeenCalledWith(PAYMENT);

    vi.clearAllMocks();
    notifyMarked("refunded", { status: "updated", paymentId: PAYMENT, previousStatus: "refunded" });
    notifyMarked("refunded", { status: "partial_refund", paymentId: PAYMENT, refundedUsd: "5.00", amountUsd: "39.99" });
    notifyMarked("refunded", { status: "unknown_order" });
    expect(m.queueEmails).not.toHaveBeenCalled();
  });
});

describe("admin booking emails", () => {
  it("a force-cancel queues the cancellation emails with the status and refund", async () => {
    m.applyForceCancel.mockResolvedValue({ ok: true, refundedCredits: 40, tutorReversal: "reverse_held", netCredits: 30 });
    const res = await forceCancelBooking({ bookingId: BOOKING, status: "cancelled_by_tutor", note: "Tutor is ill today" });
    expect(res).toMatchObject({ ok: true });
    await runQueued();
    expect(m.bookingCancelledEmails).toHaveBeenCalledWith(BOOKING, { status: "cancelled_by_tutor", refundedCredits: 40 });
  });

  it("a refused force-cancel sends nothing", async () => {
    m.applyForceCancel.mockResolvedValue({ ok: false, reason: "status", status: "completed" });
    await forceCancelBooking({ bookingId: BOOKING, status: "cancelled_by_tutor", note: "Tutor is ill today" });
    expect(m.queueEmails).not.toHaveBeenCalled();
  });

  it("a refund reversal that cancels a booking tells the tutor, with no second refund email", async () => {
    m.applyRefundReversal.mockResolvedValue({ ok: true, kind: "cancel_booking", bookingId: BOOKING, tutorReversal: "none" });
    await reverseRefundedPayment({ paymentId: PAYMENT, note: "Refunded in PayPal on request" });
    await runQueued();
    expect(m.bookingCancelledEmails).toHaveBeenCalledWith(BOOKING, { status: "cancelled_by_student", refundedCredits: 0 });
  });

  it("a refund reversal that only takes credits back sends nothing", async () => {
    m.applyRefundReversal.mockResolvedValue({ ok: true, kind: "take_credits", taken: 30, shortfall: 0 });
    await reverseRefundedPayment({ paymentId: PAYMENT, note: "Refunded in PayPal on request" });
    expect(m.queueEmails).not.toHaveBeenCalled();
  });

  it("a force-complete that wrote the earnings sends the summaries; a repeat does not", async () => {
    m.applyForceComplete.mockResolvedValue({ ok: true, earningsCreated: true, netCredits: 15 });
    await forceCompleteBooking({ bookingId: BOOKING, note: "Both joined, room crashed" });
    await runQueued();
    expect(m.sessionSummaryEmails).toHaveBeenCalledWith([BOOKING]);

    vi.clearAllMocks();
    m.requireRole.mockResolvedValue({ user: { id: "admin-1" } });
    m.applyForceComplete.mockResolvedValue({ ok: true, earningsCreated: false, netCredits: 15 });
    await forceCompleteBooking({ bookingId: BOOKING, note: "Both joined, room crashed" });
    expect(m.queueEmails).not.toHaveBeenCalled();
  });
});
