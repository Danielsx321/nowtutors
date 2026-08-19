import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, updatedAt, uuidPk } from "./_helpers";
import { bookings } from "./booking";
import {
  creditTransactionType,
  earningStatus,
  paymentProvider,
  paymentPurpose,
  paymentStatus,
  payoutMethod,
  withdrawalStatus,
} from "./enums";
import { profiles } from "./identity";

// Cache only; the authoritative balance is the ledger sum. reconcile-wallets
// asserts they agree nightly. Only lib/credits/ledger.ts writes this (CLAUDE.md).
export const wallets = pgTable(
  "wallets",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => profiles.id, { onDelete: "cascade" }),
    creditBalance: integer("credit_balance").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("wallets_balance_nonneg_chk", sql`${t.creditBalance} >= 0`)],
);

// Append-only ledger — never updated, never deleted (no updated_at). The partial
// unique index on (type, reference_id) is the idempotency guard against
// double-crediting a retried webhook (SPEC §4.4).
export const creditTransactions = pgTable(
  "credit_transactions",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id),
    delta: integer("delta").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    type: creditTransactionType("type").notNull(),
    referenceType: text("reference_type"),
    referenceId: uuid("reference_id"),
    description: text("description"),
    createdBy: uuid("created_by").references(() => profiles.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("credit_tx_user_created_idx").on(t.userId, t.createdAt.desc()),
    uniqueIndex("credit_tx_ref_unique")
      .on(t.type, t.referenceId)
      .where(sql`${t.referenceId} is not null`),
    check("credit_tx_delta_nonzero_chk", sql`${t.delta} <> 0`),
  ],
);

export const payments = pgTable("payments", {
  id: uuidPk(),
  userId: uuid("user_id")
    .notNull()
    .references(() => profiles.id),
  provider: paymentProvider("provider").notNull().default("paypal"),
  providerOrderId: text("provider_order_id").notNull().unique(),
  providerCaptureId: text("provider_capture_id"),
  amountUsd: numeric("amount_usd", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  creditsGranted: integer("credits_granted"),
  purpose: paymentPurpose("purpose").notNull(),
  bookingId: uuid("booking_id").references(() => bookings.id),
  status: paymentStatus("status").notNull().default("created"),
  rawPayload: jsonb("raw_payload"),
  capturedAt: timestamp("captured_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// One row per completed session. available_at = ended_at + earnings_hold_hours.
export const tutorEarnings = pgTable("tutor_earnings", {
  id: uuidPk(),
  tutorId: uuid("tutor_id")
    .notNull()
    .references(() => profiles.id),
  bookingId: uuid("booking_id")
    .notNull()
    .unique()
    .references(() => bookings.id),
  grossCredits: integer("gross_credits").notNull(),
  platformFeeCredits: integer("platform_fee_credits").notNull(),
  netCredits: integer("net_credits").notNull(),
  status: earningStatus("status").notNull().default("held"),
  availableAt: timestamp("available_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const withdrawalRequests = pgTable("withdrawal_requests", {
  id: uuidPk(),
  tutorId: uuid("tutor_id")
    .notNull()
    .references(() => profiles.id),
  amountCredits: integer("amount_credits").notNull(),
  amountUsd: numeric("amount_usd", { precision: 10, scale: 2 }).notNull(),
  payoutMethod: payoutMethod("payout_method").notNull().default("paypal"),
  payoutDestination: text("payout_destination").notNull(),
  status: withdrawalStatus("status").notNull().default("requested"),
  adminNote: text("admin_note"),
  externalReference: text("external_reference"),
  processedBy: uuid("processed_by").references(() => profiles.id),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
