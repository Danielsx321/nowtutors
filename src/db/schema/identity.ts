import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, updatedAt, uuidPk } from "./_helpers";
import {
  payoutMethod,
  tutorApprovalStatus,
  tutorLiveMode,
  tutorSubjectLevel,
  userRole,
} from "./enums";

// One row per auth user. id = auth.users.id (FK added in a custom migration so
// Drizzle need not model the auth schema). role is NULLABLE until onboarding
// completes (Decision #5). phone dropped — absent from the Bubble build.
export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey(),
    role: userRole("role"),
    email: text("email").notNull(),
    fullName: text("full_name"),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    country: text("country"),
    timezone: text("timezone"),
    bio: text("bio"),
    onboardingCompletedAt: timestamp("onboarding_completed_at", {
      withTimezone: true,
    }),
    isSuspended: boolean("is_suspended").notNull().default(false),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    // Opt-out model: a missing key = "on". Read via a zod schema whose defaults
    // are booking_confirmations/reminders/messages = true, marketing = false.
    notificationPreferences: jsonb("notification_preferences")
      .notNull()
      .default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("profiles_email_idx").on(t.email)],
);

// Public tutor profile. Payout data lives in tutor_payout_details (Decision A).
// instant_rate_credits_per_minute is nullable and unused — instant and scheduled
// both price off hourly_rate_credits via the single formula
// ceil(hourly_rate_credits × duration_minutes / 60) (src/lib/credits/pricing.ts).
// headline/languages/education/years_experience are
// NET-NEW additive fields (nullable; nothing gates on them).
export const tutorProfiles = pgTable(
  "tutor_profiles",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => profiles.id, { onDelete: "cascade" }),
    slug: text("slug").notNull().unique(),
    headline: text("headline"),
    about: text("about"),
    introVideoUrl: text("intro_video_url"),
    education: text("education"),
    yearsExperience: integer("years_experience"),
    languages: text("languages").array(),
    hourlyRateCredits: integer("hourly_rate_credits").notNull(),
    instantRateCreditsPerMinute: integer("instant_rate_credits_per_minute"),
    acceptsInstant: boolean("accepts_instant").notNull().default(true),
    approvalStatus: tutorApprovalStatus("approval_status")
      .notNull()
      .default("pending"),
    approvalNote: text("approval_note"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    isLive: boolean("is_live").notNull().default(false),
    liveMode: tutorLiveMode("live_mode"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    ratingAvg: numeric("rating_avg", { precision: 3, scale: 2 })
      .notNull()
      .default("0"),
    ratingCount: integer("rating_count").notNull().default(0),
    completedSessions: integer("completed_sessions").notNull().default(0),
    totalMinutesTaught: integer("total_minutes_taught").notNull().default(0),
    // Re-review tracking (SPEC §4.1/§7.1). Deliberately NOT an approval_status
    // value: approval state and change state are separate concerns. An approved
    // tutor's edit goes live immediately; a MATERIAL edit stamps
    // profile_changed_at so admins can re-review without the tutor dropping out
    // of search. Needs re-review = profile_changed_at is not null AND
    // (profile_reviewed_at is null OR profile_reviewed_at < profile_changed_at).
    // Both are trigger/admin managed — see drizzle/0011.
    profileChangedAt: timestamp("profile_changed_at", { withTimezone: true }),
    profileReviewedAt: timestamp("profile_reviewed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tutor_profiles_live_idx").on(t.isLive, t.lastSeenAt),
    index("tutor_profiles_approval_idx").on(t.approvalStatus),
    index("tutor_profiles_rating_idx").on(t.ratingAvg.desc()),
    index("tutor_profiles_rate_idx").on(t.hourlyRateCredits),
    index("tutor_profiles_languages_gin").using("gin", t.languages),
  ],
);

// Sensitive payout destination — owner + admin RLS only (Decision A).
export const tutorPayoutDetails = pgTable("tutor_payout_details", {
  id: uuidPk(),
  tutorId: uuid("tutor_id")
    .notNull()
    .unique()
    .references(() => profiles.id, { onDelete: "cascade" }),
  payoutMethod: payoutMethod("payout_method").notNull().default("paypal"),
  paypalEmail: text("paypal_email"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const subjects = pgTable("subjects", {
  id: uuidPk(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  icon: text("icon"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const tutorSubjects = pgTable(
  "tutor_subjects",
  {
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    level: tutorSubjectLevel("level"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tutorId, t.subjectId] })],
);
