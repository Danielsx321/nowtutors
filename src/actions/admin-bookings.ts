"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireRole } from "@/lib/auth/guards";
import { getEarningsSettings } from "@/lib/settings";
import {
  applyForceCancel,
  applyForceComplete,
  applyRefundReversal,
} from "@/db/queries/admin-bookings";
import {
  forceCancelSchema,
  forceCompleteSchema,
  reverseRefundSchema,
  type TutorReversal,
} from "@/lib/bookings/admin-rules";
import { bookingStatusMeta } from "@/lib/bookings/status";

/**
 * `/admin/bookings` and `/admin/payments` money actions (SPEC §7.3, §7.6, §7.11;
 * Phase 8 Part 6). `requireRole('admin')` is the first statement of each, the
 * actor always comes from the guard, and the change plus its audit row commit in
 * one transaction.
 */

export type AdminBookingActionResult = { ok: true; message: string } | { error: string };

const TUTOR_MESSAGES: Record<TutorReversal, string> = {
  none: "",
  reverse_held: " The tutor's held earnings were cancelled.",
  debit_available: " The tutor's released earnings were taken back from their wallet.",
  absorb_locked: " The tutor's earnings are already in a withdrawal, so they keep them and NowTutors absorbs the cost.",
  absorb_withdrawn: " The tutor was already paid out, so NowTutors absorbs the cost.",
};

function revalidateBooking(bookingId?: string) {
  revalidatePath("/admin/bookings");
  if (bookingId) revalidatePath(`/admin/bookings/${bookingId}`);
  revalidatePath("/admin/payments");
  revalidatePath("/admin/audit");
  revalidatePath("/admin");
  // A cancelled scheduled booking frees its slot on the tutor's public calendar.
  revalidatePath("/", "layout");
}

export async function forceCancelBooking(input: {
  bookingId: string;
  status: string;
  note: string;
}): Promise<AdminBookingActionResult> {
  const { user } = await requireRole("admin");
  const parsed = forceCancelSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid booking." };
  const { bookingId, status, note } = parsed.data;

  const res = await db.transaction((tx) =>
    applyForceCancel(tx, { bookingId, status, note, actorId: user.id, refund: "credits" }),
  );
  if (!res.ok) {
    return res.reason === "status"
      ? { error: `This booking is "${bookingStatusMeta(res.status).label}" and can't be cancelled.` }
      : { error: "Booking not found." };
  }

  revalidateBooking(bookingId);
  const refund =
    res.refundedCredits > 0
      ? `${res.refundedCredits} credits refunded to the student.`
      : "No credits were owed back to the student.";
  return { ok: true, message: `Cancelled. ${refund}${TUTOR_MESSAGES[res.tutorReversal]}` };
}

export async function forceCompleteBooking(input: {
  bookingId: string;
  note: string;
}): Promise<AdminBookingActionResult> {
  const { user } = await requireRole("admin");
  const parsed = forceCompleteSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid booking." };
  const { platformFeePercent, earningsHoldHours } = await getEarningsSettings();

  const res = await db.transaction((tx) =>
    applyForceComplete(tx, {
      ...parsed.data,
      actorId: user.id,
      platformFeePercent,
      earningsHoldHours,
    }),
  );
  if (!res.ok) {
    if (res.reason === "status") {
      return { error: `This booking is "${bookingStatusMeta(res.status).label}" and can't be completed.` };
    }
    if (res.reason === "too_early") return { error: "This session hasn't started yet, so it can't be completed." };
    if (res.reason === "no_price") {
      return { error: "This booking has no recorded price, so the tutor can't be paid. Nothing was changed." };
    }
    return { error: "Booking not found." };
  }

  revalidateBooking(parsed.data.bookingId);
  return {
    ok: true,
    message: res.earningsCreated
      ? `Completed. ${res.netCredits} credits of earnings are held for the tutor for the usual period.`
      : "Completed. The tutor's earnings for this session already existed.",
  };
}

export async function reverseRefundedPayment(input: {
  paymentId: string;
  note: string;
}): Promise<AdminBookingActionResult> {
  const { user } = await requireRole("admin");
  const parsed = reverseRefundSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid payment." };

  const res = await db.transaction((tx) =>
    applyRefundReversal(tx, { ...parsed.data, actorId: user.id }),
  );
  if (!res.ok) {
    switch (res.reason) {
      case "not_refunded":
        return { error: "PayPal hasn't reported this payment as refunded. Refund it in PayPal first, then come back." };
      case "already_reversed":
        return { error: "This refund was already reversed." };
      case "not_minted":
        return { error: "This payment never added credits, so there's nothing to take back." };
      case "booking_not_cancellable":
        return {
          error: `The booking this paid for is "${bookingStatusMeta(res.status).label}" and can't be cancelled. Use a manual credit adjustment instead.`,
        };
      default:
        return { error: "Payment not found." };
    }
  }

  revalidateBooking(res.kind === "cancel_booking" ? res.bookingId : undefined);
  if (res.kind === "cancel_booking") {
    return { ok: true, message: `The booking this payment paid for was cancelled.${TUTOR_MESSAGES[res.tutorReversal]}` };
  }
  return {
    ok: true,
    message:
      res.shortfall > 0
        ? `${res.taken} credits removed. The student had already spent ${res.shortfall}, which NowTutors absorbs.`
        : `${res.taken} credits removed from the student's wallet.`,
  };
}
