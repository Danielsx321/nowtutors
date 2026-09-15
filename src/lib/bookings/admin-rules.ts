import { z } from "zod";

/**
 * Pure rules for admin force-cancel, force-complete and PayPal refund reversal
 * (SPEC §7.3, §7.6, §7.11; Phase 8 Part 6). Settled with Noora 2026-09-15:
 *
 *  1. Force-cancel refunds the student in full, as credits, whoever asked.
 *  2. A tutor who was already paid out keeps it; the platform absorbs the cost.
 *  3. An admin can force-complete a tutor no-show on proof, which pays the tutor.
 *  4. PayPal refunds happen in PayPal; NowTutors then takes back the minted
 *     credits, or cancels the booking a direct payment paid for. Partial refunds
 *     are a manual credit adjustment.
 *
 * No database here, so each decision is unit-tested on its own.
 */

export const FORCE_CANCEL_FROM = [
  "confirmed",
  "in_progress",
  "completed",
  "no_show_student",
  "no_show_tutor",
] as const;

export const FORCE_COMPLETE_FROM = ["confirmed", "in_progress", "no_show_tutor", "no_show_student"] as const;

export const CANCEL_STATUSES = ["cancelled_by_tutor", "cancelled_by_student"] as const;
export type CancelStatus = (typeof CANCEL_STATUSES)[number];

export function canForceCancel(status: string): boolean {
  return (FORCE_CANCEL_FROM as readonly string[]).includes(status);
}

export function canForceComplete(status: string): boolean {
  return (FORCE_COMPLETE_FROM as readonly string[]).includes(status);
}

const note = z
  .string()
  .trim()
  .min(5, "Add a note saying why (at least 5 characters).")
  .max(500, "Keep the note under 500 characters.");

export const forceCancelSchema = z.object({
  bookingId: z.string().uuid(),
  status: z.enum(CANCEL_STATUSES, { error: "Choose who the cancellation is on." }),
  note,
});

export const forceCompleteSchema = z.object({ bookingId: z.string().uuid(), note });

export const reverseRefundSchema = z.object({ paymentId: z.string().uuid(), note });

export type EarningStatus = "held" | "available" | "withdrawn" | "reversed";

/** What a force-cancel does to the tutor side (rule 2). */
export type TutorReversal =
  | "none" // no earnings row, or it was already reversed
  | "reverse_held" // not money yet: mark reversed, release never pays it
  | "debit_available" // credits still in the wallet: take them back
  | "absorb_locked" // released, but held by an open withdrawal or already spent down
  | "absorb_withdrawn"; // paid out through PayPal

export function tutorReversalFor(
  earning: { status: EarningStatus; netCredits: number } | null,
  tutor: { walletBalance: number; hasOpenWithdrawal: boolean },
): TutorReversal {
  if (!earning || earning.status === "reversed") return "none";
  if (earning.status === "held") return "reverse_held";
  if (earning.status === "withdrawn") return "absorb_withdrawn";
  if (tutor.hasOpenWithdrawal || tutor.walletBalance < earning.netCredits) return "absorb_locked";
  return "debit_available";
}

/**
 * Where a scheduled booking must be before it can be force-completed: it has
 * started. Completing a session that hasn't happened would promise a tutor
 * money for time nobody taught. Instant bookings begin at accept, so they
 * always qualify.
 */
export function forceCompleteTooEarly(
  booking: { type: "scheduled" | "instant"; scheduledStartAt: Date | null },
  now: Date,
): boolean {
  return booking.type === "scheduled" && booking.scheduledStartAt !== null && booking.scheduledStartAt > now;
}

/**
 * PayPal refund reversal (rule 4), from what the ledger says about the payment.
 *
 * `standingBookingDebit` is a direct-pay whose `booking_debit` stands with no
 * `booking_refund`: the minted credits were spent on the booking, so the right
 * unwind is cancelling that booking without a credits refund (the money already
 * went back through PayPal). Otherwise the minted credits are sitting in, or
 * were spent from, the wallet, and up to the current balance is taken back.
 */
export type RefundReversalPlan =
  | { kind: "not_minted" }
  | { kind: "cancel_booking"; bookingId: string }
  | { kind: "take_credits"; take: number; shortfall: number };

export function refundReversalPlan(p: {
  mintedCredits: number;
  bookingId: string | null;
  standingBookingDebit: boolean;
  studentBalance: number;
}): RefundReversalPlan {
  if (p.mintedCredits <= 0) return { kind: "not_minted" };
  if (p.bookingId && p.standingBookingDebit) return { kind: "cancel_booking", bookingId: p.bookingId };
  const take = Math.max(0, Math.min(p.mintedCredits, p.studentBalance));
  return { kind: "take_credits", take, shortfall: p.mintedCredits - take };
}
