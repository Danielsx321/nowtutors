import "server-only";
import { eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { bookings, payments, profiles, subjects, tutorEarnings } from "@/db/schema";
import type { BookingFacts, EmailRequest } from "./types";

/**
 * Builders for the booking and payment emails (SPEC §11, Phase 10 Part 2).
 * Each one reads what it needs by id and returns the requests; the caller
 * queues them after its transaction has committed. They read, never write,
 * and return `[]` rather than throw when a row is gone.
 */

const student = alias(profiles, "student");
const tutor = alias(profiles, "tutor");

const nameOf = (display: string | null, full: string | null, fallback: string) =>
  display?.trim() || full?.trim() || fallback;

interface BookingRow {
  id: string;
  type: "scheduled" | "instant";
  status: string;
  studentId: string;
  tutorId: string;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  startedAt: Date | null;
  durationMinutes: number | null;
  priceCredits: number | null;
  studentNotes: string | null;
  subjectName: string | null;
  studentName: string;
  tutorName: string;
}

async function loadBookings(ids: string[]): Promise<BookingRow[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: bookings.id,
      type: bookings.type,
      status: bookings.status,
      studentId: bookings.studentId,
      tutorId: bookings.tutorId,
      scheduledStartAt: bookings.scheduledStartAt,
      scheduledEndAt: bookings.scheduledEndAt,
      startedAt: bookings.startedAt,
      durationMinutes: bookings.durationMinutes,
      priceCredits: bookings.priceCredits,
      studentNotes: bookings.studentNotes,
      subjectName: subjects.name,
      studentDisplay: student.displayName,
      studentFull: student.fullName,
      tutorDisplay: tutor.displayName,
      tutorFull: tutor.fullName,
    })
    .from(bookings)
    .leftJoin(subjects, eq(subjects.id, bookings.subjectId))
    .innerJoin(student, eq(student.id, bookings.studentId))
    .innerJoin(tutor, eq(tutor.id, bookings.tutorId))
    .where(inArray(bookings.id, ids));
  return rows.map((r) => ({
    ...r,
    studentName: nameOf(r.studentDisplay, r.studentFull, "your student"),
    tutorName: nameOf(r.tutorDisplay, r.tutorFull, "your tutor"),
  }));
}

/** The facts as one side sees them. Instant sessions use when they started. */
function factsFor(b: BookingRow, otherPartyName: string): BookingFacts {
  const start = b.scheduledStartAt ?? b.startedAt ?? new Date();
  const duration = b.durationMinutes ?? 60;
  const end = b.scheduledEndAt ?? new Date(start.getTime() + duration * 60_000);
  return {
    bookingId: b.id,
    subjectName: b.subjectName ?? "Tutoring",
    otherPartyName,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    durationMinutes: duration,
    priceCredits: b.priceCredits,
  };
}

/**
 * A scheduled booking just became `confirmed`: from credits in the booking
 * action, or at PayPal capture for direct pay. The student gets the
 * confirmation with the calendar invite, the tutor the new-booking notice.
 */
export async function bookingConfirmedEmails(bookingId: string): Promise<EmailRequest[]> {
  const [b] = await loadBookings([bookingId]);
  if (!b || b.type !== "scheduled" || b.status !== "confirmed") return [];
  return [
    { type: "booking-confirmed", to: { userId: b.studentId }, props: factsFor(b, b.tutorName) },
    {
      type: "tutor-new-booking",
      to: { userId: b.tutorId },
      props: { ...factsFor(b, b.studentName), studentNotes: b.studentNotes },
    },
  ];
}

/**
 * An admin force-cancelled a booking. The tutor always hears. The student
 * hears "cancelled by your tutor" when that is what happened, and otherwise a
 * refund notice when credits went back to them. A cancellation the student
 * asked for with nothing refunded needs no email: they know.
 */
export async function bookingCancelledEmails(
  bookingId: string,
  outcome: { status: "cancelled_by_tutor" | "cancelled_by_student"; refundedCredits: number },
): Promise<EmailRequest[]> {
  const [b] = await loadBookings([bookingId]);
  if (!b) return [];
  const out: EmailRequest[] = [
    {
      type: "tutor-booking-cancelled",
      to: { userId: b.tutorId },
      props: {
        ...factsFor(b, b.studentName),
        cancelledBy: outcome.status === "cancelled_by_tutor" ? "tutor" : "student",
      },
    },
  ];
  if (outcome.status === "cancelled_by_tutor") {
    out.push({
      type: "booking-cancelled-by-tutor",
      to: { userId: b.studentId },
      props: { ...factsFor(b, b.tutorName), refundedCredits: outcome.refundedCredits },
    });
  } else if (outcome.refundedCredits > 0) {
    out.push({
      type: "refund-issued",
      to: { userId: b.studentId },
      props: { via: "credits", credits: outcome.refundedCredits, bookingSubject: b.subjectName },
    });
  }
  return out;
}

/**
 * Sessions whose earnings row was just written (`earningsCreatedIds` from
 * complete-sessions, once per booking by the unique index). Completed and
 * student no-shows both land here; a tutor no-show writes no row, so it is
 * never summarised as if it happened.
 */
export async function sessionSummaryEmails(bookingIds: string[]): Promise<EmailRequest[]> {
  const rows = await loadBookings(bookingIds);
  if (rows.length === 0) return [];
  const earnings = await db
    .select({
      bookingId: tutorEarnings.bookingId,
      netCredits: tutorEarnings.netCredits,
      availableAt: tutorEarnings.availableAt,
    })
    .from(tutorEarnings)
    .where(inArray(tutorEarnings.bookingId, rows.map((r) => r.id)));
  const byBooking = new Map(earnings.map((e) => [e.bookingId, e]));

  const out: EmailRequest[] = [];
  for (const b of rows) {
    const noShow = b.status === "no_show_student";
    if (b.status !== "completed" && !noShow) continue;
    out.push({
      type: "session-summary-student",
      to: { userId: b.studentId },
      props: { ...factsFor(b, b.tutorName), noShow },
    });
    const e = byBooking.get(b.id);
    if (e) {
      out.push({
        type: "session-summary-tutor",
        to: { userId: b.tutorId },
        props: {
          ...factsFor(b, b.studentName),
          noShow,
          netCredits: e.netCredits,
          availableAt: e.availableAt ? e.availableAt.toISOString() : null,
        },
      });
    }
  }
  return out;
}

interface PaymentRow {
  id: string;
  userId: string;
  purpose: "credit_purchase" | "booking";
  amountUsd: string;
  currency: string;
  creditsGranted: number | null;
  bookingId: string | null;
  payerEmail: string | null;
  payerName: string;
}

async function loadPayment(paymentId: string): Promise<PaymentRow | null> {
  const [p] = await db
    .select({
      id: payments.id,
      userId: payments.userId,
      purpose: payments.purpose,
      amountUsd: payments.amountUsd,
      currency: payments.currency,
      creditsGranted: payments.creditsGranted,
      bookingId: payments.bookingId,
      payerEmail: profiles.email,
      payerDisplay: profiles.displayName,
      payerFull: profiles.fullName,
    })
    .from(payments)
    .leftJoin(profiles, eq(profiles.id, payments.userId))
    .where(eq(payments.id, paymentId))
    .limit(1);
  if (!p) return null;
  return {
    ...p,
    purpose: p.purpose as PaymentRow["purpose"],
    payerName: p.payerFull?.trim() || p.payerDisplay?.trim() || p.payerEmail || "A student",
  };
}

/** A credit purchase was captured and credited, once (`settleCapture` → `credited`). */
export async function creditsPurchasedEmails(
  paymentId: string,
  credited: { credits: number; balanceAfter: number },
): Promise<EmailRequest[]> {
  const p = await loadPayment(paymentId);
  if (!p) return [];
  return [
    {
      type: "credits-purchased",
      to: { userId: p.userId },
      props: { credits: credited.credits, amountUsd: p.amountUsd, currency: p.currency, balanceAfter: credited.balanceAfter },
    },
  ];
}

/** A capture moved to `failed` for the first time. The admins hear. */
export async function captureFailedEmails(paymentId: string): Promise<EmailRequest[]> {
  const p = await loadPayment(paymentId);
  if (!p) return [];
  return [
    {
      type: "admin-capture-failed",
      to: { admins: true },
      props: {
        paymentId: p.id,
        payerName: p.payerName,
        payerEmail: p.payerEmail,
        amountUsd: p.amountUsd,
        currency: p.currency,
        purpose: p.purpose,
      },
    },
  ];
}

/** A payment moved to `refunded` (in full) for the first time. The payer hears. */
export async function paypalRefundEmails(paymentId: string): Promise<EmailRequest[]> {
  const p = await loadPayment(paymentId);
  if (!p) return [];
  return [
    {
      type: "refund-issued",
      to: { userId: p.userId },
      props: { via: "paypal", amountUsd: p.amountUsd, currency: p.currency },
    },
  ];
}

/**
 * The reminders for one claimed booking (Part 3). 24h goes to the student
 * only; 1h to both (SPEC §11). A booking that stopped being `confirmed` since
 * it was claimed sends nothing.
 */
export async function reminderEmails(kind: "24h" | "1h", bookingId: string): Promise<EmailRequest[]> {
  const [b] = await loadBookings([bookingId]);
  if (!b || b.type !== "scheduled" || b.status !== "confirmed") return [];
  if (kind === "24h") {
    return [{ type: "reminder-24h", to: { userId: b.studentId }, props: factsFor(b, b.tutorName) }];
  }
  return [
    { type: "reminder-1h-student", to: { userId: b.studentId }, props: factsFor(b, b.tutorName) },
    { type: "reminder-1h-tutor", to: { userId: b.tutorId }, props: factsFor(b, b.studentName) },
  ];
}

