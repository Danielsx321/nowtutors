import { pgEnum } from "drizzle-orm/pg-core";

// SPEC §4 enums. The instant_* credit_transaction_type values from the Phase 1
// ledger decision (instant-session hold) were DROPPED in drizzle/0014 — §18 made
// instant billing a single flat booking_debit and the live app has no hold model
// (docs/DECISIONS.md, Phase 6 pre-build).
export const userRole = pgEnum("user_role", ["student", "tutor", "admin"]);

export const tutorApprovalStatus = pgEnum("tutor_approval_status", [
  "pending",
  "approved",
  "rejected",
]);

export const tutorLiveMode = pgEnum("tutor_live_mode", ["instant", "broadcast"]);

export const tutorSubjectLevel = pgEnum("tutor_subject_level", [
  "beginner",
  "intermediate",
  "advanced",
  "all",
]);

export const bookingType = pgEnum("booking_type", ["scheduled", "instant"]);

export const bookingStatus = pgEnum("booking_status", [
  "pending_payment",
  "confirmed",
  "in_progress",
  "completed",
  "cancelled_by_student",
  "cancelled_by_tutor",
  "no_show_student",
  "no_show_tutor",
  "expired",
]);

export const sessionRequestStatus = pgEnum("session_request_status", [
  "pending",
  "accepted",
  "declined",
  "expired",
  "cancelled",
  // Terminal state for an accept whose credit debit failed (the student's
  // balance moved between request and accept). Distinct from `declined` and
  // `expired` so an operator can tell a refusal from a payment failure
  // (SPEC §4.3, drizzle/0014).
  "failed_payment",
]);

export const paymentMethod = pgEnum("payment_method", ["credits", "paypal"]);

export const creditTransactionType = pgEnum("credit_transaction_type", [
  "purchase",
  "booking_debit",
  "booking_refund",
  "session_earning",
  "withdrawal_hold",
  "withdrawal_paid",
  "withdrawal_reversed",
  "admin_adjustment",
]);

export const paymentProvider = pgEnum("payment_provider", ["paypal"]);

export const paymentPurpose = pgEnum("payment_purpose", [
  "credit_purchase",
  "booking",
]);

export const paymentStatus = pgEnum("payment_status", [
  "created",
  "approved",
  "captured",
  "failed",
  "refunded",
]);

export const earningStatus = pgEnum("earning_status", [
  "held",
  "available",
  "withdrawn",
]);

export const withdrawalStatus = pgEnum("withdrawal_status", [
  "requested",
  "approved",
  "paid",
  "rejected",
  "cancelled",
]);

export const payoutMethod = pgEnum("payout_method", ["paypal"]);

export const broadcastStatus = pgEnum("broadcast_status", ["live", "ended"]);
