import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, uuidPk } from "./_helpers";
import { creditTransactions } from "./money";
import { profiles } from "./identity";

/**
 * The weekly availability bonus (SPEC §4.4, §7.5, §7.11, §12; availability-bonus,
 * 2026-10-14). Noora's tutor ad promises $40 a week to a tutor who is online
 * 5 hours in the week. These two tables are what make that a rule the platform
 * pays on its own.
 *
 * `tutor_online_time` is the presence history the heartbeat never kept: one
 * row per tutor per UTC day, seconds the tutor was LIVE (`is_live = true`),
 * added on every heartbeat and capped per beat at the presence staleness
 * window (`lib/presence/staleness.ts`). Written only by the trusted server
 * from `db/queries/presence.ts`; a tutor reads their own rows, admins read all.
 *
 * `availability_bonus_awards` is one row per tutor per week that was paid.
 * HISTORY ONLY since 2026-11-15, when the rule became monthly (20 live hours a
 * month, 100 credits, paid on the 1st after the month ends). Nothing writes it
 * any more; the monthly job reads it once, to take weekly credits already paid
 * for weeks starting in November 2026 off the first monthly award.
 *
 * `availability_bonus_monthly_awards` is one row per tutor per paid month
 * (monthly-availability-bonus, drizzle/0030). The unique `(tutor_id,
 * month_start)` plus the ledger's own unique `(type, reference_id)` (the award
 * id is the reference) make a double credit impossible however many times the
 * job runs. `credits` is the net amount paid and may be 0 when weekly credits
 * already covered it; the row still marks the month settled.
 */
export const tutorOnlineTime = pgTable(
  "tutor_online_time",
  {
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    /** UTC calendar day the seconds belong to. */
    day: date("day").notNull(),
    seconds: integer("seconds").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tutorId, t.day] }),
    index("tutor_online_time_day_idx").on(t.day),
    check("tutor_online_time_seconds_chk", sql`${t.seconds} >= 0`),
  ],
);

export const availabilityBonusAwards = pgTable(
  "availability_bonus_awards",
  {
    id: uuidPk(),
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    /** The Monday (UTC) of the week that was paid. */
    weekStart: date("week_start").notNull(),
    liveSeconds: integer("live_seconds").notNull(),
    credits: integer("credits").notNull(),
    /** The ledger row that paid it; set in the same transaction as the credit. */
    transactionId: uuid("transaction_id").references(() => creditTransactions.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("availability_bonus_awards_week_unique").on(t.tutorId, t.weekStart),
    index("availability_bonus_awards_week_idx").on(t.weekStart.desc()),
    check("availability_bonus_awards_credits_chk", sql`${t.credits} > 0`),
  ],
);

export const availabilityBonusMonthlyAwards = pgTable(
  "availability_bonus_monthly_awards",
  {
    id: uuidPk(),
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    /** The 1st (UTC) of the month that was paid. */
    monthStart: date("month_start").notNull(),
    liveSeconds: integer("live_seconds").notNull(),
    /** Net credits paid: the monthly amount minus weekly credits already paid for weeks starting in this month. */
    credits: integer("credits").notNull(),
    weeklyCreditsDeducted: integer("weekly_credits_deducted").notNull().default(0),
    /** The ledger row that paid it; null when the net was 0. */
    transactionId: uuid("transaction_id").references(() => creditTransactions.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("availability_bonus_monthly_awards_month_unique").on(t.tutorId, t.monthStart),
    index("availability_bonus_monthly_awards_month_idx").on(t.monthStart.desc()),
    check("availability_bonus_monthly_awards_credits_chk", sql`${t.credits} >= 0`),
    check("availability_bonus_monthly_awards_deducted_chk", sql`${t.weeklyCreditsDeducted} >= 0`),
    check("availability_bonus_monthly_awards_month_chk", sql`extract(day from ${t.monthStart}) = 1`),
  ],
);
