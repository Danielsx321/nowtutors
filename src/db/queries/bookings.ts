import "server-only";
import { aliasedTable, and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import {
  availabilityExceptions,
  availabilityRules,
  bookings,
  profiles,
  subjects,
  tutorProfiles,
  tutorSubjects,
  wallets,
} from "@/db/schema";
import { computeSlots } from "@/lib/availability/compute-slots";
import { SLOT_STEP_MINUTES } from "@/lib/availability/validate-slot";
import { getBookingSettings } from "@/lib/settings";
import type {
  AvailabilityException,
  AvailabilityRule,
  ExistingBooking,
} from "@/lib/availability/compute-slots";

/**
 * Booking statuses that occupy the tutor for overlap/slot purposes (SPEC §4.3).
 * `pending_payment` is included because a live direct-pay checkout genuinely
 * holds the slot — but only for {@link PENDING_PAYMENT_HOLD_MINUTES}, which
 * `computeSlots` applies using each row's `created_at` (§4.2). Loading them and
 * letting the pure function age them keeps that rule in one place.
 */
const OCCUPYING_STATUSES = ["pending_payment", "confirmed", "in_progress"] as const;

export interface SlotComputationData {
  tutorTimeZone: string;
  hourlyRateCredits: number;
  approvalStatus: string;
  rules: AvailabilityRule[];
  exceptions: AvailabilityException[];
  bookings: ExistingBooking[];
}

/**
 * Everything the slot calculator and the booking action need for one tutor, in a
 * single round trip: the tutor's timezone + rate + approval, their active rules,
 * their exceptions, and the scheduled bookings that already occupy them. Used by
 * both the public calendar (render) and the create action (re-validate).
 */
export async function getSlotComputationData(
  tutorId: string,
): Promise<SlotComputationData | null> {
  const [tp] = await db
    .select({
      timeZone: profiles.timezone,
      hourlyRateCredits: tutorProfiles.hourlyRateCredits,
      approvalStatus: tutorProfiles.approvalStatus,
    })
    .from(tutorProfiles)
    .innerJoin(profiles, eq(profiles.id, tutorProfiles.userId))
    .where(eq(tutorProfiles.userId, tutorId))
    .limit(1);
  if (!tp) return null;

  const [ruleRows, exceptionRows, bookingRows] = await Promise.all([
    db
      .select({
        weekday: availabilityRules.weekday,
        startTime: availabilityRules.startTime,
        endTime: availabilityRules.endTime,
        isActive: availabilityRules.isActive,
      })
      .from(availabilityRules)
      .where(eq(availabilityRules.tutorId, tutorId)),
    db
      .select({
        date: availabilityExceptions.date,
        isAvailable: availabilityExceptions.isAvailable,
        startTime: availabilityExceptions.startTime,
        endTime: availabilityExceptions.endTime,
      })
      .from(availabilityExceptions)
      .where(eq(availabilityExceptions.tutorId, tutorId)),
    db
      .select({
        startAt: bookings.scheduledStartAt,
        endAt: bookings.scheduledEndAt,
        status: bookings.status,
        createdAt: bookings.createdAt,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.tutorId, tutorId),
          inArray(bookings.status, OCCUPYING_STATUSES),
          isNotNull(bookings.scheduledStartAt),
          isNotNull(bookings.scheduledEndAt),
        ),
      ),
  ]);

  return {
    tutorTimeZone: tp.timeZone ?? "UTC",
    hourlyRateCredits: tp.hourlyRateCredits,
    approvalStatus: tp.approvalStatus,
    rules: ruleRows.map((r) => ({
      weekday: r.weekday,
      startTime: r.startTime,
      endTime: r.endTime,
      isActive: r.isActive,
    })),
    exceptions: exceptionRows.map((e) => ({
      date: e.date,
      isAvailable: e.isAvailable,
      startTime: e.startTime,
      endTime: e.endTime,
    })),
    bookings: bookingRows
      .filter((b) => !!b.startAt && !!b.endAt)
      .map((b) => ({
        startAt: b.startAt as Date,
        endAt: b.endAt as Date,
        status: b.status,
        createdAt: b.createdAt,
      })),
  };
}

export interface BookableSubject {
  id: string;
  name: string;
}

/** Active subjects the tutor teaches, for the booking subject picker. */
export async function getBookableSubjects(tutorId: string): Promise<BookableSubject[]> {
  return db
    .select({ id: subjects.id, name: subjects.name })
    .from(tutorSubjects)
    .innerJoin(subjects, eq(subjects.id, tutorSubjects.subjectId))
    .where(and(eq(tutorSubjects.tutorId, tutorId), eq(subjects.isActive, true)))
    .orderBy(asc(subjects.sortOrder));
}

/** The signed-in student's cached credit balance (0 if no wallet row yet). */
export async function getWalletBalance(userId: string): Promise<number> {
  const [row] = await db
    .select({ balance: wallets.creditBalance })
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);
  return row?.balance ?? 0;
}

export interface BookingCalendar {
  tutorTimeZone: string;
  hourlyRateCredits: number;
  durations: number[];
  /** ISO-8601 UTC start instants, keyed by duration. Render in the viewer's tz. */
  slotsByDuration: Record<number, string[]>;
}

function utcYmd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Server-computed bookable slots for an approved tutor, one list per offered
 * duration (SPEC §7.3). Uses the same pure computeSlots() the create action
 * re-validates against and the same 30-min grid, so a rendered slot is a
 * bookable slot. Range is generous in UTC; the notice + horizon cutoffs inside
 * computeSlots do the real bounding. Null when the tutor can't be booked.
 */
export async function getPublicBookingCalendar(
  tutorId: string,
): Promise<BookingCalendar | null> {
  const data = await getSlotComputationData(tutorId);
  if (!data || data.approvalStatus !== "approved") return null;

  const settings = await getBookingSettings();
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const to = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + settings.maxBookingDaysAhead + 1),
  );

  const slotsByDuration: Record<number, string[]> = {};
  for (const duration of settings.sessionDurations) {
    const slots = computeSlots({
      rules: data.rules,
      exceptions: data.exceptions,
      bookings: data.bookings,
      range: { from: utcYmd(from), to: utcYmd(to) },
      tutorTimeZone: data.tutorTimeZone,
      viewerTimeZone: "UTC",
      now,
      minBookingNoticeMinutes: settings.minBookingNoticeMinutes,
      maxBookingDaysAhead: settings.maxBookingDaysAhead,
      slotDurationMinutes: duration,
      slotStepMinutes: SLOT_STEP_MINUTES,
    });
    slotsByDuration[duration] = slots.map((s) => s.startUtc.toISOString());
  }

  return {
    tutorTimeZone: data.tutorTimeZone,
    hourlyRateCredits: data.hourlyRateCredits,
    durations: settings.sessionDurations,
    slotsByDuration,
  };
}

export type BookingTab = "upcoming" | "past" | "cancelled";

const TAB_STATUSES: Record<BookingTab, readonly string[]> = {
  upcoming: ["confirmed", "in_progress"],
  past: ["completed"],
  cancelled: [
    "cancelled_by_student",
    "cancelled_by_tutor",
    "no_show_student",
    "no_show_tutor",
    "expired",
    "pending_payment",
  ],
};

export interface BookingListItem {
  id: string;
  status: string;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  durationMinutes: number | null;
  priceCredits: number | null;
  subjectName: string | null;
  otherPartyName: string | null;
  otherPartyAvatarUrl: string | null;
}

/**
 * Bookings for one participant, enriched with the OTHER party and the subject.
 * `role` selects which side the caller is on so we surface the counterpart.
 * RLS scopes bookings to participants; the page guard re-checks the role
 * (SPEC §5 Layer 2). Scheduled-only for this phase (instant is Phase 6).
 */
export async function getBookingsForParticipant(
  userId: string,
  role: "student" | "tutor",
): Promise<BookingListItem[]> {
  const other = aliasedTable(profiles, "other_party");
  const mineColumn = role === "student" ? bookings.studentId : bookings.tutorId;
  const otherColumn = role === "student" ? bookings.tutorId : bookings.studentId;

  const rows = await db
    .select({
      id: bookings.id,
      status: bookings.status,
      scheduledStartAt: bookings.scheduledStartAt,
      scheduledEndAt: bookings.scheduledEndAt,
      durationMinutes: bookings.durationMinutes,
      priceCredits: bookings.priceCredits,
      subjectName: subjects.name,
      otherPartyName: other.displayName,
      otherPartyFullName: other.fullName,
      otherPartyAvatarUrl: other.avatarUrl,
    })
    .from(bookings)
    .leftJoin(subjects, eq(subjects.id, bookings.subjectId))
    .innerJoin(other, eq(other.id, otherColumn))
    .where(and(eq(mineColumn, userId), eq(bookings.type, "scheduled")))
    .orderBy(desc(bookings.scheduledStartAt));

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    scheduledStartAt: r.scheduledStartAt,
    scheduledEndAt: r.scheduledEndAt,
    durationMinutes: r.durationMinutes,
    priceCredits: r.priceCredits,
    subjectName: r.subjectName,
    otherPartyName: r.otherPartyName ?? r.otherPartyFullName ?? null,
    otherPartyAvatarUrl: r.otherPartyAvatarUrl,
  }));
}

export function groupBookingsByTab(
  items: BookingListItem[],
): Record<BookingTab, BookingListItem[]> {
  const out: Record<BookingTab, BookingListItem[]> = {
    upcoming: [],
    past: [],
    cancelled: [],
  };
  for (const item of items) {
    const tab = (Object.keys(TAB_STATUSES) as BookingTab[]).find((t) =>
      TAB_STATUSES[t].includes(item.status),
    );
    if (tab) out[tab].push(item);
  }
  // Upcoming reads soonest-first; the others newest-first (query is desc).
  out.upcoming.reverse();
  return out;
}

export interface BookingDetail extends BookingListItem {
  studentNotes: string | null;
  bookingType: string;
  otherPartyRole: "student" | "tutor";
  isStudent: boolean;
}

/**
 * A single booking the caller participates in, with the other party resolved.
 * Returns null if the booking doesn't exist OR the caller isn't a participant
 * (so a non-participant is indistinguishable from a missing booking).
 */
export async function getBookingDetailForParticipant(
  bookingId: string,
  userId: string,
): Promise<BookingDetail | null> {
  const student = aliasedTable(profiles, "student_p");
  const tutor = aliasedTable(profiles, "tutor_p");
  const [row] = await db
    .select({
      id: bookings.id,
      status: bookings.status,
      type: bookings.type,
      studentId: bookings.studentId,
      tutorId: bookings.tutorId,
      scheduledStartAt: bookings.scheduledStartAt,
      scheduledEndAt: bookings.scheduledEndAt,
      durationMinutes: bookings.durationMinutes,
      priceCredits: bookings.priceCredits,
      studentNotes: bookings.studentNotes,
      subjectName: subjects.name,
      studentName: student.displayName,
      studentFullName: student.fullName,
      studentAvatarUrl: student.avatarUrl,
      tutorName: tutor.displayName,
      tutorFullName: tutor.fullName,
      tutorAvatarUrl: tutor.avatarUrl,
    })
    .from(bookings)
    .leftJoin(subjects, eq(subjects.id, bookings.subjectId))
    .innerJoin(student, eq(student.id, bookings.studentId))
    .innerJoin(tutor, eq(tutor.id, bookings.tutorId))
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!row) return null;
  const isStudent = row.studentId === userId;
  const isTutor = row.tutorId === userId;
  if (!isStudent && !isTutor) return null;

  return {
    id: row.id,
    status: row.status,
    bookingType: row.type,
    scheduledStartAt: row.scheduledStartAt,
    scheduledEndAt: row.scheduledEndAt,
    durationMinutes: row.durationMinutes,
    priceCredits: row.priceCredits,
    subjectName: row.subjectName,
    studentNotes: row.studentNotes,
    isStudent,
    otherPartyRole: isStudent ? "tutor" : "student",
    otherPartyName: isStudent
      ? (row.tutorName ?? row.tutorFullName ?? null)
      : (row.studentName ?? row.studentFullName ?? null),
    otherPartyAvatarUrl: isStudent ? row.tutorAvatarUrl : row.studentAvatarUrl,
  };
}
