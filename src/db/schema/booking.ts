import {
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, updatedAt, uuidPk } from "./_helpers";
import {
  bookingStatus,
  bookingType,
  paymentMethod,
  sessionRequestStatus,
} from "./enums";
import { profiles, subjects } from "./identity";

// Scheduled + instant bookings. scheduled_* are null for instant. payment_id
// FK -> payments is added in a custom migration (avoids a module import cycle
// with money.ts, which references bookings). reminder_*_sent_at give the
// booking-reminders cron its idempotency stamps (Decision #2).
export const bookings = pgTable(
  "bookings",
  {
    id: uuidPk(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => profiles.id),
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => profiles.id),
    subjectId: uuid("subject_id").references(() => subjects.id),
    type: bookingType("type").notNull(),
    status: bookingStatus("status").notNull(),
    scheduledStartAt: timestamp("scheduled_start_at", { withTimezone: true }),
    scheduledEndAt: timestamp("scheduled_end_at", { withTimezone: true }),
    durationMinutes: integer("duration_minutes"),
    priceCredits: integer("price_credits"),
    priceUsd: numeric("price_usd", { precision: 10, scale: 2 }),
    paymentMethod: paymentMethod("payment_method"),
    paymentId: uuid("payment_id"),
    lessonspaceRoomId: text("lessonspace_room_id"),
    agoraChannel: text("agora_channel"),
    studentJoinedAt: timestamp("student_joined_at", { withTimezone: true }),
    tutorJoinedAt: timestamp("tutor_joined_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    billedMinutes: integer("billed_minutes"),
    cancelledBy: uuid("cancelled_by").references(() => profiles.id),
    cancellationReason: text("cancellation_reason"),
    studentNotes: text("student_notes"),
    reminder24hSentAt: timestamp("reminder_24h_sent_at", { withTimezone: true }),
    reminder1hSentAt: timestamp("reminder_1h_sent_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("bookings_student_status_idx").on(t.studentId, t.status),
    index("bookings_tutor_start_idx").on(t.tutorId, t.scheduledStartAt),
    index("bookings_status_start_idx").on(t.status, t.scheduledStartAt),
  ],
);

// Instant-session handshake. Realtime-enabled (custom migration). expires_at is
// enforced server-side; the client countdown is cosmetic (SPEC §7.4).
export const sessionRequests = pgTable(
  "session_requests",
  {
    id: uuidPk(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => profiles.id),
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => profiles.id),
    subjectId: uuid("subject_id").references(() => subjects.id),
    message: text("message"),
    status: sessionRequestStatus("status").notNull().default("pending"),
    bookingId: uuid("booking_id").references(() => bookings.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("session_requests_tutor_status_idx").on(t.tutorId, t.status),
    index("session_requests_status_expires_idx").on(t.status, t.expiresAt),
  ],
);

// NOTE: reviews table deferred — no Review type exists in the Bubble build
// (Decision C). Ratings live as scalar columns on tutor_profiles.
