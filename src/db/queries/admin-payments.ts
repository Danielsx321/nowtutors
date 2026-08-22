import "server-only";
import { aliasedTable, asc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import {
  bookings,
  creditTransactions,
  payments,
  profiles,
  subjects,
} from "@/db/schema";
import type { CreditTransactionType } from "@/lib/credits/ledger";

/**
 * Reconciliation lookup for `/admin/payments` (SPEC §6, §7.6).
 *
 * This is the view that debugs the one live transaction that cannot be run from
 * Port Harcourt, so it deliberately favours **showing everything** over showing
 * it prettily: the payments row as recorded, every ledger row that references
 * it, the booking when it is a direct-pay, and the raw PayPal payload.
 *
 * Read-only. Nothing here mutates — reversing credits on a refund is an admin
 * action with its own design pass (§18 item 4), not part of this view.
 */

export interface AdminPaymentLedgerRow {
  id: string;
  userId: string;
  delta: number;
  balanceAfter: number;
  type: CreditTransactionType;
  referenceType: string | null;
  referenceId: string | null;
  description: string | null;
  createdAt: Date;
}

export interface AdminPaymentBooking {
  id: string;
  status: string;
  type: string;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  durationMinutes: number | null;
  priceCredits: number | null;
  paymentMethod: string | null;
  subjectName: string | null;
  studentName: string | null;
  tutorName: string | null;
  createdAt: Date;
}

export interface AdminPaymentRecord {
  id: string;
  userId: string;
  buyerName: string | null;
  buyerEmail: string | null;
  provider: string;
  providerOrderId: string;
  providerCaptureId: string | null;
  amountUsd: string;
  currency: string;
  creditsGranted: number | null;
  purpose: string;
  status: string;
  bookingId: string | null;
  rawPayload: unknown;
  capturedAt: Date | null;
  createdAt: Date;
  updatedAt: Date | null;
  /** Ledger rows referencing this payment, and the booking it paid for. */
  ledger: AdminPaymentLedgerRow[];
  booking: AdminPaymentBooking | null;
}

/**
 * Find one payment by PayPal **order id or capture id** — an admin debugging a
 * transaction may have either to hand, and a refund event carries only the
 * capture. Exact match on both; no fuzzy lookup on the money path.
 */
export async function findPaymentForAdmin(
  reference: string,
): Promise<AdminPaymentRecord | null> {
  const ref = reference.trim();
  if (!ref) return null;

  const [row] = await db
    .select({
      id: payments.id,
      userId: payments.userId,
      buyerName: profiles.displayName,
      buyerFullName: profiles.fullName,
      buyerEmail: profiles.email,
      provider: payments.provider,
      providerOrderId: payments.providerOrderId,
      providerCaptureId: payments.providerCaptureId,
      amountUsd: payments.amountUsd,
      currency: payments.currency,
      creditsGranted: payments.creditsGranted,
      purpose: payments.purpose,
      status: payments.status,
      bookingId: payments.bookingId,
      rawPayload: payments.rawPayload,
      capturedAt: payments.capturedAt,
      createdAt: payments.createdAt,
      updatedAt: payments.updatedAt,
    })
    .from(payments)
    .leftJoin(profiles, eq(profiles.id, payments.userId))
    .where(
      or(
        eq(payments.providerOrderId, ref),
        eq(payments.providerCaptureId, ref),
      ),
    )
    .limit(1);

  if (!row) return null;

  // Every ledger row that points at this payment OR at the booking it paid for.
  // A direct-pay writes two: the `purchase` mint (reference_id = payments.id)
  // and the `booking_debit` spend (reference_id = bookings.id) — showing only
  // one of them would make a correct settlement look half-done (§7.6).
  const ledgerRefs = row.bookingId
    ? or(
        eq(creditTransactions.referenceId, row.id),
        eq(creditTransactions.referenceId, row.bookingId),
      )
    : eq(creditTransactions.referenceId, row.id);

  const ledger = await db
    .select({
      id: creditTransactions.id,
      userId: creditTransactions.userId,
      delta: creditTransactions.delta,
      balanceAfter: creditTransactions.balanceAfter,
      type: creditTransactions.type,
      referenceType: creditTransactions.referenceType,
      referenceId: creditTransactions.referenceId,
      description: creditTransactions.description,
      createdAt: creditTransactions.createdAt,
    })
    .from(creditTransactions)
    .where(ledgerRefs)
    .orderBy(asc(creditTransactions.createdAt));

  let booking: AdminPaymentBooking | null = null;
  if (row.bookingId) {
    const student = aliasedTable(profiles, "student_p");
    const tutor = aliasedTable(profiles, "tutor_p");
    const [b] = await db
      .select({
        id: bookings.id,
        status: bookings.status,
        type: bookings.type,
        scheduledStartAt: bookings.scheduledStartAt,
        scheduledEndAt: bookings.scheduledEndAt,
        durationMinutes: bookings.durationMinutes,
        priceCredits: bookings.priceCredits,
        paymentMethod: bookings.paymentMethod,
        subjectName: subjects.name,
        studentName: student.displayName,
        studentFullName: student.fullName,
        tutorName: tutor.displayName,
        tutorFullName: tutor.fullName,
        createdAt: bookings.createdAt,
      })
      .from(bookings)
      .leftJoin(subjects, eq(subjects.id, bookings.subjectId))
      .leftJoin(student, eq(student.id, bookings.studentId))
      .leftJoin(tutor, eq(tutor.id, bookings.tutorId))
      .where(eq(bookings.id, row.bookingId))
      .limit(1);

    if (b) {
      booking = {
        id: b.id,
        status: b.status,
        type: b.type,
        scheduledStartAt: b.scheduledStartAt,
        scheduledEndAt: b.scheduledEndAt,
        durationMinutes: b.durationMinutes,
        priceCredits: b.priceCredits,
        paymentMethod: b.paymentMethod,
        subjectName: b.subjectName,
        studentName: b.studentName ?? b.studentFullName ?? null,
        tutorName: b.tutorName ?? b.tutorFullName ?? null,
        createdAt: b.createdAt,
      };
    }
  }

  return {
    id: row.id,
    userId: row.userId,
    buyerName: row.buyerName ?? row.buyerFullName ?? null,
    buyerEmail: row.buyerEmail,
    provider: row.provider,
    providerOrderId: row.providerOrderId,
    providerCaptureId: row.providerCaptureId,
    amountUsd: row.amountUsd,
    currency: row.currency,
    creditsGranted: row.creditsGranted,
    purpose: row.purpose,
    status: row.status,
    bookingId: row.bookingId,
    rawPayload: row.rawPayload,
    capturedAt: row.capturedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ledger,
    booking,
  };
}
