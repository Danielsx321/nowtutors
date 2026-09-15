import "server-only";
import { aliasedTable, and, count, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import {
  auditLog,
  bookings,
  creditTransactions,
  payments,
  profiles,
  subjects,
  tutorEarnings,
  wallets,
  withdrawalRequests,
} from "@/db/schema";
import {
  creditWallet,
  debitWallet,
  DuplicateLedgerReferenceError,
  walletExecutor,
} from "@/lib/credits/ledger";
import { splitEarnings } from "@/lib/credits/fees";
import { insertHeldEarnings } from "@/db/queries/earnings";
import {
  canForceCancel,
  canForceComplete,
  forceCompleteTooEarly,
  refundReversalPlan,
  tutorReversalFor,
  type CancelStatus,
  type EarningStatus,
  type TutorReversal,
} from "@/lib/bookings/admin-rules";

/**
 * `/admin/bookings` reads and the three money-moving admin actions (SPEC §7.3,
 * §7.6, §7.11; Phase 8 Part 6). The rules are in `lib/bookings/admin-rules.ts`;
 * this file applies them inside the caller's transaction.
 *
 * Every `apply*` locks the rows it decides on (`FOR UPDATE`), moves credits only
 * through `lib/credits/ledger.ts` inside a savepoint (a duplicate reference is a
 * unique violation, which would otherwise abort the transaction), and writes its
 * `audit_log` row in the same transaction. Lock order is booking, then student
 * wallet, then tutor earnings and wallet, so two admin actions can't deadlock on
 * each other.
 */

export const BOOKINGS_PAGE_SIZE = 25;

const student = aliasedTable(profiles, "student");
const tutor = aliasedTable(profiles, "tutor");

type Tx = DbTransaction;

export interface AdminBookingRow {
  id: string;
  type: "scheduled" | "instant";
  status: string;
  startsAt: Date;
  durationMinutes: number | null;
  priceCredits: number | null;
  paymentMethod: string | null;
  studentId: string;
  studentName: string;
  tutorId: string;
  tutorName: string;
  subjectName: string | null;
  earningStatus: EarningStatus | null;
}

export interface AdminBookingFilter {
  status: string | null;
  /** Lower-cased, trimmed; matched literally against either participant. */
  q: string | null;
  /** `YYYY-MM-DD`, inclusive, in `timeZone`. */
  from: string | null;
  to: string | null;
  timeZone: string;
  page?: number;
}

const startsAtSql = sql<Date>`coalesce(${bookings.scheduledStartAt}, ${bookings.createdAt})`;
const nameSql = (t: typeof student) =>
  sql<string>`coalesce(${t.displayName}, ${t.fullName}, ${t.email})`;

function filterWhere(f: AdminBookingFilter): SQL | undefined {
  const c: SQL[] = [];
  if (f.status) c.push(sql`${bookings.status} = ${f.status}::booking_status`);
  if (f.q) {
    c.push(sql`(
      position(${f.q} in lower(${student.email})) > 0
      or position(${f.q} in lower(coalesce(${student.displayName}, ''))) > 0
      or position(${f.q} in lower(${tutor.email})) > 0
      or position(${f.q} in lower(coalesce(${tutor.displayName}, ''))) > 0
    )`);
  }
  if (f.from) c.push(sql`${startsAtSql} >= (${f.from}::date)::timestamp at time zone ${f.timeZone}`);
  if (f.to) c.push(sql`${startsAtSql} < ((${f.to}::date + 1)::timestamp at time zone ${f.timeZone})`);
  return c.length ? and(...c) : undefined;
}

export async function listAdminBookings(
  f: AdminBookingFilter,
): Promise<{ bookings: AdminBookingRow[]; total: number; page: number; pageCount: number }> {
  const page = Math.max(1, Math.floor(f.page ?? 1));
  const where = filterWhere(f);
  const base = () =>
    db
      .select({ n: count() })
      .from(bookings)
      .innerJoin(student, eq(student.id, bookings.studentId))
      .innerJoin(tutor, eq(tutor.id, bookings.tutorId))
      .where(where);

  const [[totalRow], rows] = await Promise.all([
    base(),
    db
      .select({
        id: bookings.id,
        type: bookings.type,
        status: bookings.status,
        startsAt: startsAtSql,
        durationMinutes: bookings.durationMinutes,
        priceCredits: bookings.priceCredits,
        paymentMethod: bookings.paymentMethod,
        studentId: bookings.studentId,
        studentName: nameSql(student),
        tutorId: bookings.tutorId,
        tutorName: nameSql(tutor),
        subjectName: subjects.name,
        earningStatus: tutorEarnings.status,
      })
      .from(bookings)
      .innerJoin(student, eq(student.id, bookings.studentId))
      .innerJoin(tutor, eq(tutor.id, bookings.tutorId))
      .leftJoin(subjects, eq(subjects.id, bookings.subjectId))
      .leftJoin(tutorEarnings, eq(tutorEarnings.bookingId, bookings.id))
      .where(where)
      .orderBy(desc(startsAtSql), desc(bookings.id))
      .limit(BOOKINGS_PAGE_SIZE)
      .offset((page - 1) * BOOKINGS_PAGE_SIZE),
  ]);

  const total = Number(totalRow?.n ?? 0);
  return {
    bookings: rows.map((r) => ({ ...r, startsAt: new Date(r.startsAt) })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / BOOKINGS_PAGE_SIZE)),
  };
}

export interface AdminBookingDetail extends AdminBookingRow {
  scheduledEndAt: Date | null;
  startedAt: Date | null;
  endedAt: Date | null;
  studentJoinedAt: Date | null;
  tutorJoinedAt: Date | null;
  cancellationReason: string | null;
  createdAt: Date;
  studentEmail: string;
  tutorEmail: string;
  earning: {
    status: EarningStatus;
    grossCredits: number;
    platformFeeCredits: number;
    netCredits: number;
    availableAt: Date | null;
  } | null;
  ledger: { id: string; userId: string; type: string; delta: number; balanceAfter: number; createdAt: Date }[];
  payment: { id: string; providerOrderId: string; status: string; purpose: string; amountUsd: string } | null;
}

export async function getAdminBookingDetail(bookingId: string): Promise<AdminBookingDetail | null> {
  const [[b], ledger] = await Promise.all([
    db
      .select({
        id: bookings.id,
        type: bookings.type,
        status: bookings.status,
        startsAt: startsAtSql,
        durationMinutes: bookings.durationMinutes,
        priceCredits: bookings.priceCredits,
        paymentMethod: bookings.paymentMethod,
        paymentId: bookings.paymentId,
        studentId: bookings.studentId,
        studentName: nameSql(student),
        studentEmail: student.email,
        tutorId: bookings.tutorId,
        tutorName: nameSql(tutor),
        tutorEmail: tutor.email,
        subjectName: subjects.name,
        scheduledEndAt: bookings.scheduledEndAt,
        startedAt: bookings.startedAt,
        endedAt: bookings.endedAt,
        studentJoinedAt: bookings.studentJoinedAt,
        tutorJoinedAt: bookings.tutorJoinedAt,
        cancellationReason: bookings.cancellationReason,
        createdAt: bookings.createdAt,
        earningStatus: tutorEarnings.status,
        grossCredits: tutorEarnings.grossCredits,
        platformFeeCredits: tutorEarnings.platformFeeCredits,
        netCredits: tutorEarnings.netCredits,
        availableAt: tutorEarnings.availableAt,
      })
      .from(bookings)
      .innerJoin(student, eq(student.id, bookings.studentId))
      .innerJoin(tutor, eq(tutor.id, bookings.tutorId))
      .leftJoin(subjects, eq(subjects.id, bookings.subjectId))
      .leftJoin(tutorEarnings, eq(tutorEarnings.bookingId, bookings.id))
      .where(eq(bookings.id, bookingId))
      .limit(1),
    db
      .select({
        id: creditTransactions.id,
        userId: creditTransactions.userId,
        type: creditTransactions.type,
        delta: creditTransactions.delta,
        balanceAfter: creditTransactions.balanceAfter,
        createdAt: creditTransactions.createdAt,
      })
      .from(creditTransactions)
      .where(eq(creditTransactions.referenceId, bookingId))
      .orderBy(creditTransactions.createdAt),
  ]);
  if (!b) return null;

  const [payment] = await db
    .select({
      id: payments.id,
      providerOrderId: payments.providerOrderId,
      status: payments.status,
      purpose: payments.purpose,
      amountUsd: payments.amountUsd,
    })
    .from(payments)
    .where(b.paymentId ? or(eq(payments.id, b.paymentId), eq(payments.bookingId, bookingId)) : eq(payments.bookingId, bookingId))
    .limit(1);

  // paymentId was only needed for the lookup above; it isn't part of the detail.
  const { paymentId, grossCredits, platformFeeCredits, netCredits, availableAt, ...rest } = b;
  void paymentId;
  return {
    ...rest,
    startsAt: new Date(b.startsAt),
    earning:
      b.earningStatus && grossCredits !== null && platformFeeCredits !== null && netCredits !== null
        ? { status: b.earningStatus, grossCredits, platformFeeCredits, netCredits, availableAt }
        : null,
    ledger,
    payment: payment ?? null,
  };
}

async function lockBooking(tx: Tx, bookingId: string) {
  const [b] = await tx
    .select({
      id: bookings.id,
      type: bookings.type,
      status: bookings.status,
      studentId: bookings.studentId,
      tutorId: bookings.tutorId,
      priceCredits: bookings.priceCredits,
      durationMinutes: bookings.durationMinutes,
      scheduledStartAt: bookings.scheduledStartAt,
      scheduledEndAt: bookings.scheduledEndAt,
      endedAt: bookings.endedAt,
    })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .for("update")
    .limit(1);
  return b ?? null;
}

/** Run a ledger write in a savepoint; true when it landed, false when the reference already existed. */
async function ledgerOnce(tx: Tx, write: (ex: ReturnType<typeof walletExecutor>) => Promise<unknown>): Promise<boolean> {
  try {
    await tx.transaction((sp) => write(walletExecutor(sp)).then(() => undefined));
    return true;
  } catch (err) {
    if (err instanceof DuplicateLedgerReferenceError) return false;
    throw err;
  }
}

export type ForceCancelResult =
  | { ok: true; refundedCredits: number; tutorReversal: TutorReversal; netCredits: number | null }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "status"; status: string };

/**
 * Force-cancel (rules 1 and 2). `refund: "credits"` gives the student back what
 * their `booking_debit` took, once (`booking_refund`, reference = the booking).
 * `refund: "paypal"` is the refund-reversal path: the money already went back
 * through PayPal, so no credits move for the student.
 */
export async function applyForceCancel(
  tx: Tx,
  p: { bookingId: string; status: CancelStatus; note: string; actorId: string; refund: "credits" | "paypal" },
): Promise<ForceCancelResult> {
  const b = await lockBooking(tx, p.bookingId);
  if (!b) return { ok: false, reason: "not_found" };
  if (!canForceCancel(b.status)) return { ok: false, reason: "status", status: b.status };

  await tx
    .update(bookings)
    .set({ status: p.status, cancelledBy: p.actorId, cancellationReason: p.note })
    .where(eq(bookings.id, p.bookingId));

  let refundedCredits = 0;
  if (p.refund === "credits") {
    const [debit] = await tx
      .select({ delta: creditTransactions.delta })
      .from(creditTransactions)
      .where(and(eq(creditTransactions.type, "booking_debit"), eq(creditTransactions.referenceId, p.bookingId)))
      .limit(1);
    const amount = debit ? -debit.delta : 0;
    if (amount > 0) {
      const landed = await ledgerOnce(tx, (ex) =>
        creditWallet(ex, {
          userId: b.studentId,
          delta: amount,
          type: "booking_refund",
          referenceType: "booking",
          referenceId: p.bookingId,
          description: "Session cancelled and refunded",
          createdBy: p.actorId,
        }),
      );
      if (landed) refundedCredits = amount;
    }
  }

  const [earning] = await tx
    .select({ status: tutorEarnings.status, netCredits: tutorEarnings.netCredits })
    .from(tutorEarnings)
    .where(eq(tutorEarnings.bookingId, p.bookingId))
    .for("update")
    .limit(1);

  let tutorReversal: TutorReversal = "none";
  if (earning) {
    const [wallet] = await tx
      .select({ balance: wallets.creditBalance })
      .from(wallets)
      .where(eq(wallets.userId, b.tutorId))
      .for("update")
      .limit(1);
    const [open] = await tx
      .select({ id: withdrawalRequests.id })
      .from(withdrawalRequests)
      .where(and(eq(withdrawalRequests.tutorId, b.tutorId), inArray(withdrawalRequests.status, ["requested", "approved"])))
      .limit(1);
    tutorReversal = tutorReversalFor(earning, { walletBalance: wallet?.balance ?? 0, hasOpenWithdrawal: !!open });

    if (tutorReversal === "debit_available") {
      await ledgerOnce(tx, (ex) =>
        debitWallet(ex, {
          userId: b.tutorId,
          amount: earning.netCredits,
          type: "earning_reversal",
          referenceType: "booking",
          referenceId: p.bookingId,
          description: "Session cancelled: earnings reversed",
          createdBy: p.actorId,
        }),
      );
    }
    if (tutorReversal === "reverse_held" || tutorReversal === "debit_available") {
      await tx.update(tutorEarnings).set({ status: "reversed" }).where(eq(tutorEarnings.bookingId, p.bookingId));
    }
  }

  await tx.insert(auditLog).values({
    actorId: p.actorId,
    action: "booking.force_cancel",
    targetType: "booking",
    targetId: p.bookingId,
    payload: {
      from: b.status,
      to: p.status,
      note: p.note,
      refund_via: p.refund,
      refunded_credits: refundedCredits,
      earning_status_before: earning?.status ?? null,
      net_credits: earning?.netCredits ?? null,
      tutor_reversal: tutorReversal,
    },
  });
  return { ok: true, refundedCredits, tutorReversal, netCredits: earning?.netCredits ?? null };
}

export type ForceCompleteResult =
  | { ok: true; earningsCreated: boolean; netCredits: number }
  | { ok: false; reason: "not_found" | "too_early" | "no_price" }
  | { ok: false; reason: "status"; status: string };

/**
 * Force-complete (rule 3). The earnings row is written by the same
 * `insertHeldEarnings` the cron uses (one per booking, `ON CONFLICT DO
 * NOTHING`), split by the same `splitEarnings`, held for the usual period from
 * `ended_at`. A `no_show_student` already has its row, so only the status moves.
 */
export async function applyForceComplete(
  tx: Tx,
  p: {
    bookingId: string;
    note: string;
    actorId: string;
    platformFeePercent: number;
    earningsHoldHours: number;
    now?: Date;
  },
): Promise<ForceCompleteResult> {
  const now = p.now ?? new Date();
  const b = await lockBooking(tx, p.bookingId);
  if (!b) return { ok: false, reason: "not_found" };
  if (!canForceComplete(b.status)) return { ok: false, reason: "status", status: b.status };
  if (forceCompleteTooEarly(b, now)) return { ok: false, reason: "too_early" };
  if (b.priceCredits === null) return { ok: false, reason: "no_price" };

  // ended_at records when the session ended, set in SQL so a scheduled end is
  // copied exactly (a JavaScript Date would drop the microseconds): the existing
  // stamp if a sweep or participant wrote one, else the scheduled end once it has
  // passed, else now. available_at derives from what was written (§7.11).
  const [ended] = await tx
    .update(bookings)
    .set({
      status: "completed",
      endedAt: sql`coalesce(${bookings.endedAt}, case when ${bookings.type} = 'scheduled' and ${bookings.scheduledEndAt} < now() then ${bookings.scheduledEndAt} else now() end)`,
      billedMinutes: sql`coalesce(${bookings.billedMinutes}, ${bookings.durationMinutes})`,
    })
    .where(eq(bookings.id, p.bookingId))
    .returning({ endedAt: bookings.endedAt });
  const endedAt = ended?.endedAt ?? now;

  const split = splitEarnings(b.priceCredits, p.platformFeePercent);
  const inserted = await insertHeldEarnings(
    [
      {
        bookingId: b.id,
        tutorId: b.tutorId,
        grossCredits: split.grossCredits,
        platformFeeCredits: split.platformFeeCredits,
        netCredits: split.netCredits,
        availableAt: new Date(endedAt.getTime() + p.earningsHoldHours * 60 * 60 * 1000),
      },
    ],
    tx,
  );

  await tx.insert(auditLog).values({
    actorId: p.actorId,
    action: "booking.force_complete",
    targetType: "booking",
    targetId: p.bookingId,
    payload: {
      from: b.status,
      note: p.note,
      earnings_created: inserted.length > 0,
      net_credits: split.netCredits,
    },
  });
  return { ok: true, earningsCreated: inserted.length > 0, netCredits: split.netCredits };
}

export type RefundReversalResult =
  | { ok: true; kind: "cancel_booking"; bookingId: string; tutorReversal: TutorReversal }
  | { ok: true; kind: "take_credits"; taken: number; shortfall: number }
  | { ok: false; reason: "not_found" | "not_refunded" | "already_reversed" | "not_minted" }
  | { ok: false; reason: "booking_not_cancellable"; status: string };

/**
 * After a refund made in PayPal (rule 4). Once per payment: a second press finds
 * this action's own audit row under the payment lock and refuses, which also
 * covers the case where nothing could be taken (a zero-credit ledger row isn't
 * allowed, so the ledger alone can't record it).
 */
export async function applyRefundReversal(
  tx: Tx,
  p: { paymentId: string; note: string; actorId: string },
): Promise<RefundReversalResult> {
  const [payment] = await tx
    .select({ id: payments.id, status: payments.status, userId: payments.userId, bookingId: payments.bookingId })
    .from(payments)
    .where(eq(payments.id, p.paymentId))
    .for("update")
    .limit(1);
  if (!payment) return { ok: false, reason: "not_found" };
  if (payment.status !== "refunded") return { ok: false, reason: "not_refunded" };

  const [done] = await tx
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(and(eq(auditLog.action, "payment.reverse_refund"), eq(auditLog.targetId, p.paymentId)))
    .limit(1);
  if (done) return { ok: false, reason: "already_reversed" };

  const [mint] = await tx
    .select({ delta: creditTransactions.delta })
    .from(creditTransactions)
    .where(and(eq(creditTransactions.type, "purchase"), eq(creditTransactions.referenceId, p.paymentId)))
    .limit(1);

  let standingBookingDebit = false;
  if (payment.bookingId) {
    const legs = await tx
      .select({ type: creditTransactions.type })
      .from(creditTransactions)
      .where(
        and(
          eq(creditTransactions.referenceId, payment.bookingId),
          inArray(creditTransactions.type, ["booking_debit", "booking_refund"]),
        ),
      );
    standingBookingDebit =
      legs.some((l) => l.type === "booking_debit") && !legs.some((l) => l.type === "booking_refund");
  }

  const [wallet] = await tx
    .select({ balance: wallets.creditBalance })
    .from(wallets)
    .where(eq(wallets.userId, payment.userId))
    .for("update")
    .limit(1);

  const plan = refundReversalPlan({
    mintedCredits: mint?.delta ?? 0,
    bookingId: payment.bookingId,
    standingBookingDebit,
    studentBalance: wallet?.balance ?? 0,
  });
  if (plan.kind === "not_minted") return { ok: false, reason: "not_minted" };

  let result: RefundReversalResult;
  if (plan.kind === "cancel_booking") {
    const cancelled = await applyForceCancel(tx, {
      bookingId: plan.bookingId,
      status: "cancelled_by_student",
      note: p.note,
      actorId: p.actorId,
      refund: "paypal",
    });
    if (!cancelled.ok) {
      return cancelled.reason === "status"
        ? { ok: false, reason: "booking_not_cancellable", status: cancelled.status }
        : { ok: false, reason: "not_found" };
    }
    result = { ok: true, kind: "cancel_booking", bookingId: plan.bookingId, tutorReversal: cancelled.tutorReversal };
  } else {
    if (plan.take > 0) {
      await ledgerOnce(tx, (ex) =>
        debitWallet(ex, {
          userId: payment.userId,
          amount: plan.take,
          type: "purchase_reversal",
          referenceType: "payment",
          referenceId: p.paymentId,
          description: "PayPal refund: purchased credits removed",
          createdBy: p.actorId,
        }),
      );
    }
    result = { ok: true, kind: "take_credits", taken: plan.take, shortfall: plan.shortfall };
  }

  await tx.insert(auditLog).values({
    actorId: p.actorId,
    action: "payment.reverse_refund",
    targetType: "payment",
    targetId: p.paymentId,
    payload: {
      note: p.note,
      minted_credits: mint?.delta ?? 0,
      booking_id: payment.bookingId,
      plan: plan.kind,
      taken: plan.kind === "take_credits" ? plan.take : 0,
      shortfall: plan.kind === "take_credits" ? plan.shortfall : 0,
      tutor_reversal: result.ok && result.kind === "cancel_booking" ? result.tutorReversal : null,
    },
  });
  return result;
}
