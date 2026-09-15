import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canForceCancel,
  canForceComplete,
  forceCancelSchema,
  forceCompleteSchema,
  forceCompleteTooEarly,
  refundReversalPlan,
  reverseRefundSchema,
  tutorReversalFor,
} from "@/lib/bookings/admin-rules";

/**
 * The Part 6 money rules settled with Noora on 2026-09-15 (SPEC §7.3, §7.6,
 * §7.11; Phase 8 Part 6). Pure: each decision on its own, no database.
 */

describe("which bookings can be force-cancelled or force-completed", () => {
  it("cancel: anything that took the student's credits and isn't already unwound", () => {
    for (const s of ["confirmed", "in_progress", "completed", "no_show_student", "no_show_tutor"]) {
      expect(canForceCancel(s), s).toBe(true);
    }
    for (const s of ["pending_payment", "expired", "cancelled_by_student", "cancelled_by_tutor", "nope"]) {
      expect(canForceCancel(s), s).toBe(false);
    }
  });

  it("complete: stuck or no-show sessions, never completed, cancelled, expired or unpaid ones", () => {
    for (const s of ["confirmed", "in_progress", "no_show_tutor", "no_show_student"]) {
      expect(canForceComplete(s), s).toBe(true);
    }
    for (const s of ["completed", "pending_payment", "expired", "cancelled_by_student", "cancelled_by_tutor"]) {
      expect(canForceComplete(s), s).toBe(false);
    }
  });

  it("a scheduled session that hasn't started can't be completed; instant always can", () => {
    const now = new Date("2026-09-15T10:00:00Z");
    expect(forceCompleteTooEarly({ type: "scheduled", scheduledStartAt: new Date("2026-09-15T10:00:01Z") }, now)).toBe(true);
    expect(forceCompleteTooEarly({ type: "scheduled", scheduledStartAt: new Date("2026-09-15T10:00:00Z") }, now)).toBe(false);
    expect(forceCompleteTooEarly({ type: "instant", scheduledStartAt: null }, now)).toBe(false);
  });
});

describe("tutorReversalFor (rule 2)", () => {
  const wallet = (walletBalance: number, hasOpenWithdrawal = false) => ({ walletBalance, hasOpenWithdrawal });

  it("no earnings row, or one already reversed, touches nothing", () => {
    expect(tutorReversalFor(null, wallet(100))).toBe("none");
    expect(tutorReversalFor({ status: "reversed", netCredits: 38 }, wallet(100))).toBe("none");
  });

  it("held earnings aren't money yet, so they're simply reversed", () => {
    expect(tutorReversalFor({ status: "held", netCredits: 38 }, wallet(0, true))).toBe("reverse_held");
  });

  it("released earnings still covered by the wallet are taken back, at exactly the balance too", () => {
    expect(tutorReversalFor({ status: "available", netCredits: 38 }, wallet(38))).toBe("debit_available");
    expect(tutorReversalFor({ status: "available", netCredits: 38 }, wallet(500))).toBe("debit_available");
  });

  it("released earnings locked in a withdrawal or no longer covered are absorbed", () => {
    expect(tutorReversalFor({ status: "available", netCredits: 38 }, wallet(37))).toBe("absorb_locked");
    expect(tutorReversalFor({ status: "available", netCredits: 38 }, wallet(500, true))).toBe("absorb_locked");
  });

  it("paid-out earnings are absorbed, whatever the wallet holds", () => {
    expect(tutorReversalFor({ status: "withdrawn", netCredits: 38 }, wallet(1000))).toBe("absorb_withdrawn");
  });
});

describe("refundReversalPlan (rule 4)", () => {
  const booking = randomUUID();

  it("a payment that minted nothing has nothing to reverse", () => {
    expect(refundReversalPlan({ mintedCredits: 0, bookingId: null, standingBookingDebit: false, studentBalance: 50 })).toEqual({
      kind: "not_minted",
    });
  });

  it("a direct payment whose booking debit still stands cancels that booking instead of taking credits", () => {
    expect(refundReversalPlan({ mintedCredits: 45, bookingId: booking, standingBookingDebit: true, studentBalance: 0 })).toEqual({
      kind: "cancel_booking",
      bookingId: booking,
    });
  });

  it("otherwise takes back the minted credits, capped at the balance, and reports the shortfall", () => {
    expect(refundReversalPlan({ mintedCredits: 30, bookingId: null, standingBookingDebit: false, studentBalance: 300 })).toEqual({
      kind: "take_credits",
      take: 30,
      shortfall: 0,
    });
    expect(refundReversalPlan({ mintedCredits: 30, bookingId: null, standingBookingDebit: false, studentBalance: 10 })).toEqual({
      kind: "take_credits",
      take: 10,
      shortfall: 20,
    });
    expect(refundReversalPlan({ mintedCredits: 30, bookingId: booking, standingBookingDebit: false, studentBalance: 0 })).toEqual({
      kind: "take_credits",
      take: 0,
      shortfall: 30,
    });
  });
});

describe("input schemas", () => {
  it("a cancel needs a uuid, who it's on, and a trimmed note of 5 to 500 characters", () => {
    const ok = forceCancelSchema.parse({ bookingId: randomUUID(), status: "cancelled_by_tutor", note: "  Tutor ill  " });
    expect(ok.note).toBe("Tutor ill");
    expect(forceCancelSchema.safeParse({ bookingId: randomUUID(), status: "", note: "Tutor ill" }).error?.issues[0]?.message).toBe(
      "Choose who the cancellation is on.",
    );
    expect(forceCancelSchema.safeParse({ bookingId: randomUUID(), status: "completed", note: "Tutor ill" }).success).toBe(false);
    expect(forceCancelSchema.safeParse({ bookingId: randomUUID(), status: "cancelled_by_student", note: "no" }).success).toBe(false);
  });

  it("complete and refund reversal need a uuid and a note", () => {
    expect(forceCompleteSchema.safeParse({ bookingId: "x", note: "Tutor sent recording" }).success).toBe(false);
    expect(forceCompleteSchema.safeParse({ bookingId: randomUUID(), note: "x".repeat(501) }).success).toBe(false);
    expect(reverseRefundSchema.safeParse({ paymentId: randomUUID(), note: "Full refund in PayPal" }).success).toBe(true);
  });
});
