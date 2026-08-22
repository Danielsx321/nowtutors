"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { bookings, tutorSubjects } from "@/db/schema";
import {
  EmailNotVerifiedError,
  requireRole,
  requireVerifiedEmail,
} from "@/lib/auth/guards";
import { getSlotComputationData } from "@/db/queries/bookings";
import { getBookingSettings } from "@/lib/settings";
import { isSlotOpen } from "@/lib/availability/validate-slot";
import { sessionPriceCredits } from "@/lib/credits/pricing";
import {
  debitWallet,
  DuplicateLedgerReferenceError,
  InsufficientCreditsError,
  pgErrorCode,
  walletExecutor,
} from "@/lib/credits/ledger";

export type CreateBookingResult =
  | { ok: true; bookingId: string }
  | { error: string };

const inputSchema = z.object({
  tutorId: z.string().uuid(),
  subjectId: z.string().uuid(),
  startAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().positive(),
  notes: z.string().trim().max(1000).optional(),
});

export type CreateBookingInput = z.infer<typeof inputSchema>;

/** Postgres SQLSTATE for an exclusion-constraint violation (bookings_no_overlap). */
const EXCLUSION_VIOLATION = "23P01";

/**
 * Create a scheduled booking paid in credits (SPEC §7.3, credits path).
 *
 * Everything the client sends is re-derived or re-validated server-side — the
 * client is never trusted for identity, price, or slot availability (SPEC §5):
 *  1. guard: student role + verified email; the student id comes from the guard.
 *  2. re-validate the requested slot with the same pure computeSlots() the
 *     calendar used, over freshly loaded rules/exceptions/bookings.
 *  3. re-derive the price with the one pricing formula; never accept a client price.
 *  4. debit + insert the booking in ONE transaction, so a failure rolls back both
 *     — no debited-but-no-booking and no booking-without-debit.
 *  5. the scheduled-overlap GiST exclusion (SPEC §4.3) is the last-writer backstop
 *     against a slot won between re-validation and insert; a clean error surfaces.
 */
export async function createScheduledBooking(
  input: CreateBookingInput,
): Promise<CreateBookingResult> {
  let student;
  try {
    await requireRole("student");
    student = await requireVerifiedEmail();
  } catch (err) {
    if (err instanceof EmailNotVerifiedError) return { error: err.message };
    throw err; // a redirect (not signed in / wrong role) must propagate
  }

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { error: "Please check the booking details and try again." };
  const v = parsed.data;

  if (v.tutorId === student.id) return { error: "You can't book a session with yourself." };

  const settings = await getBookingSettings();
  if (!settings.sessionDurations.includes(v.durationMinutes)) {
    return { error: "Pick a session length of 30, 60, or 90 minutes." };
  }

  const startAt = new Date(v.startAt);
  if (Number.isNaN(startAt.getTime())) return { error: "That start time isn't valid." };

  const data = await getSlotComputationData(v.tutorId);
  if (!data || data.approvalStatus !== "approved") {
    return { error: "This tutor isn't available for booking." };
  }

  // The tutor must actually teach the requested subject.
  const [teaches] = await db
    .select({ subjectId: tutorSubjects.subjectId })
    .from(tutorSubjects)
    .where(and(eq(tutorSubjects.tutorId, v.tutorId), eq(tutorSubjects.subjectId, v.subjectId)))
    .limit(1);
  if (!teaches) return { error: "This tutor doesn't teach that subject." };

  // Server-side slot re-validation — the heart of "don't trust the client slot".
  const open = isSlotOpen(
    {
      rules: data.rules,
      exceptions: data.exceptions,
      bookings: data.bookings,
      tutorTimeZone: data.tutorTimeZone,
      now: new Date(),
      minBookingNoticeMinutes: settings.minBookingNoticeMinutes,
      maxBookingDaysAhead: settings.maxBookingDaysAhead,
      durationMinutes: v.durationMinutes,
    },
    startAt,
  );
  if (!open) return { error: "That time is no longer available. Please pick another slot." };

  // Server-authoritative price. Never read a price off the client.
  const price = sessionPriceCredits(data.hourlyRateCredits, v.durationMinutes);
  const endAt = new Date(startAt.getTime() + v.durationMinutes * 60_000);

  try {
    const bookingId = await db.transaction(async (tx) => {
      // Insert first: the GiST exclusion rejects a slot won since re-validation
      // before we touch the wallet. If the debit then fails, this rolls back too.
      const [inserted] = await tx
        .insert(bookings)
        .values({
          studentId: student.id,
          tutorId: v.tutorId,
          subjectId: v.subjectId,
          type: "scheduled",
          status: "confirmed",
          scheduledStartAt: startAt,
          scheduledEndAt: endAt,
          durationMinutes: v.durationMinutes,
          priceCredits: price,
          paymentMethod: "credits",
          studentNotes: v.notes ?? null,
        })
        .returning({ id: bookings.id });

      await debitWallet(walletExecutor(tx), {
        userId: student.id,
        amount: price,
        type: "booking_debit",
        referenceType: "booking",
        referenceId: inserted.id,
        description: `Scheduled ${v.durationMinutes}-min session`,
      });

      return inserted.id;
    });

    revalidatePath("/dashboard/bookings");
    revalidatePath("/tutor/bookings");
    return { ok: true, bookingId };
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return { error: "You don't have enough credits for this session. Top up and try again." };
    }
    if (err instanceof DuplicateLedgerReferenceError) {
      // A fresh booking id can't collide; treat defensively as a transient retry.
      return { error: "This booking was already processed. Check your bookings list." };
    }
    if (pgErrorCode(err) === EXCLUSION_VIOLATION) {
      return { error: "That time was just booked by someone else. Please pick another slot." };
    }
    throw err;
  }
}
