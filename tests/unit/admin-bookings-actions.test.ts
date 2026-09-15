import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Authorization and ordering for the Part 6 admin money actions (SPEC §5 Layer 2,
 * §7.3, §7.6, §7.11). Guard first, before any input is trusted, any setting is
 * read or any transaction opens; the actor from the guard; every result mapped
 * to what the admin reads. The query layer is mocked.
 */

const m = vi.hoisted(() => ({
  calls: [] as string[],
  requireRole: vi.fn(),
  getEarningsSettings: vi.fn(),
  applyForceCancel: vi.fn(),
  applyForceComplete: vi.fn(),
  applyRefundReversal: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({
  requireRole: (...a: unknown[]) => {
    m.calls.push("guard");
    return m.requireRole(...a);
  },
}));
vi.mock("@/lib/settings", () => ({
  getEarningsSettings: () => {
    m.calls.push("settings");
    return m.getEarningsSettings();
  },
}));
vi.mock("@/db", () => ({
  db: {
    transaction: (fn: (tx: unknown) => unknown) => {
      m.calls.push("transaction");
      return fn("tx");
    },
  },
}));
vi.mock("@/db/queries/admin-bookings", () => ({
  applyForceCancel: (...a: unknown[]) => {
    m.calls.push("applyForceCancel");
    return m.applyForceCancel(...a);
  },
  applyForceComplete: (...a: unknown[]) => {
    m.calls.push("applyForceComplete");
    return m.applyForceComplete(...a);
  },
  applyRefundReversal: (...a: unknown[]) => {
    m.calls.push("applyRefundReversal");
    return m.applyRefundReversal(...a);
  },
}));

const { forceCancelBooking, forceCompleteBooking, reverseRefundedPayment } = await import("@/actions/admin-bookings");

const ADMIN_ID = randomUUID();
const BOOKING = randomUUID();
const PAYMENT = randomUUID();
const redirect = () => Promise.reject(new Error("NEXT_REDIRECT"));

beforeEach(() => {
  vi.clearAllMocks();
  m.calls.length = 0;
  m.requireRole.mockResolvedValue({ user: { id: ADMIN_ID }, profile: { role: "admin" } });
  m.getEarningsSettings.mockResolvedValue({ platformFeePercent: 25, earningsHoldHours: 48 });
});

describe("guard first", () => {
  it.each([
    ["forceCancelBooking", () => forceCancelBooking({ bookingId: BOOKING, status: "cancelled_by_tutor", note: "Tutor ill" })],
    ["forceCancelBooking, bad input", () => forceCancelBooking({ bookingId: "x", status: "x", note: "" })],
    ["forceCompleteBooking", () => forceCompleteBooking({ bookingId: BOOKING, note: "Tutor proof" })],
    ["reverseRefundedPayment", () => reverseRefundedPayment({ paymentId: PAYMENT, note: "Refunded in PayPal" })],
  ] as [string, () => Promise<unknown>][])("%s: a non-admin is refused before anything else", async (_, run) => {
    m.requireRole.mockImplementation(redirect);
    await expect(run()).rejects.toThrow("NEXT_REDIRECT");
    expect(m.calls).toEqual(["guard"]);
  });
});

describe("forceCancelBooking", () => {
  it("validates before the transaction", async () => {
    expect(await forceCancelBooking({ bookingId: BOOKING, status: "", note: "Tutor ill" })).toEqual({
      error: "Choose who the cancellation is on.",
    });
    expect(m.calls).toEqual(["guard"]);
  });

  it("always refunds as credits, with the guard's actor and the trimmed note", async () => {
    m.applyForceCancel.mockResolvedValue({ ok: true, refundedCredits: 60, tutorReversal: "reverse_held", netCredits: 45 });
    const res = await forceCancelBooking({ bookingId: BOOKING, status: "cancelled_by_tutor", note: " Tutor ill " });
    expect(m.applyForceCancel).toHaveBeenCalledWith("tx", {
      bookingId: BOOKING,
      status: "cancelled_by_tutor",
      note: "Tutor ill",
      actorId: ADMIN_ID,
      refund: "credits",
    });
    expect(res).toEqual({ ok: true, message: "Cancelled. 60 credits refunded to the student. The tutor's held earnings were cancelled." });
  });

  it("explains each tutor outcome and a status that can't be cancelled", async () => {
    m.applyForceCancel.mockResolvedValueOnce({ ok: true, refundedCredits: 0, tutorReversal: "absorb_withdrawn", netCredits: 45 });
    expect(await forceCancelBooking({ bookingId: BOOKING, status: "cancelled_by_student", note: "Asked to" })).toEqual({
      ok: true,
      message: "Cancelled. No credits were owed back to the student. The tutor was already paid out, so NowTutors absorbs the cost.",
    });
    m.applyForceCancel.mockResolvedValueOnce({ ok: false, reason: "status", status: "cancelled_by_tutor" });
    expect(await forceCancelBooking({ bookingId: BOOKING, status: "cancelled_by_student", note: "Asked to" })).toEqual({
      error: 'This booking is "Cancelled by tutor" and can\'t be cancelled.',
    });
  });
});

describe("forceCompleteBooking", () => {
  it("reads the earnings settings only after the guard and validation, and passes them in", async () => {
    m.applyForceComplete.mockResolvedValue({ ok: true, earningsCreated: true, netCredits: 45 });
    expect(await forceCompleteBooking({ bookingId: BOOKING, note: "Tutor sent the recording" })).toEqual({
      ok: true,
      message: "Completed. 45 credits of earnings are held for the tutor for the usual period.",
    });
    expect(m.calls).toEqual(["guard", "settings", "transaction", "applyForceComplete"]);
    expect(m.applyForceComplete).toHaveBeenCalledWith("tx", {
      bookingId: BOOKING,
      note: "Tutor sent the recording",
      actorId: ADMIN_ID,
      platformFeePercent: 25,
      earningsHoldHours: 48,
    });

    m.calls.length = 0;
    expect(await forceCompleteBooking({ bookingId: BOOKING, note: "no" })).toMatchObject({ error: expect.any(String) });
    expect(m.calls).toEqual(["guard"]);
  });

  it("maps every refusal", async () => {
    m.applyForceComplete.mockResolvedValueOnce({ ok: false, reason: "too_early" });
    expect(await forceCompleteBooking({ bookingId: BOOKING, note: "Tutor proof" })).toEqual({
      error: "This session hasn't started yet, so it can't be completed.",
    });
    m.applyForceComplete.mockResolvedValueOnce({ ok: false, reason: "no_price" });
    expect((await forceCompleteBooking({ bookingId: BOOKING, note: "Tutor proof" })) as { error: string }).toMatchObject({
      error: expect.stringMatching(/no recorded price/),
    });
    m.applyForceComplete.mockResolvedValueOnce({ ok: false, reason: "status", status: "completed" });
    expect(await forceCompleteBooking({ bookingId: BOOKING, note: "Tutor proof" })).toEqual({
      error: 'This booking is "Completed" and can\'t be completed.',
    });
  });
});

describe("reverseRefundedPayment", () => {
  it("reports taken credits and any shortfall", async () => {
    m.applyRefundReversal.mockResolvedValueOnce({ ok: true, kind: "take_credits", taken: 10, shortfall: 20 });
    expect(await reverseRefundedPayment({ paymentId: PAYMENT, note: "Refunded in PayPal" })).toEqual({
      ok: true,
      message: "10 credits removed. The student had already spent 20, which NowTutors absorbs.",
    });
    expect(m.applyRefundReversal).toHaveBeenCalledWith("tx", { paymentId: PAYMENT, note: "Refunded in PayPal", actorId: ADMIN_ID });
  });

  it("reports a cancelled direct-pay booking and each refusal", async () => {
    m.applyRefundReversal.mockResolvedValueOnce({ ok: true, kind: "cancel_booking", bookingId: BOOKING, tutorReversal: "none" });
    expect(await reverseRefundedPayment({ paymentId: PAYMENT, note: "Refunded in PayPal" })).toEqual({
      ok: true,
      message: "The booking this payment paid for was cancelled.",
    });
    m.applyRefundReversal.mockResolvedValueOnce({ ok: false, reason: "not_refunded" });
    expect(await reverseRefundedPayment({ paymentId: PAYMENT, note: "Refunded in PayPal" })).toMatchObject({
      error: expect.stringMatching(/Refund it in PayPal first/),
    });
    m.applyRefundReversal.mockResolvedValueOnce({ ok: false, reason: "already_reversed" });
    expect(await reverseRefundedPayment({ paymentId: PAYMENT, note: "Refunded in PayPal" })).toEqual({
      error: "This refund was already reversed.",
    });
  });
});
