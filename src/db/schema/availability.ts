import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  pgTable,
  smallint,
  time,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, updatedAt, uuidPk } from "./_helpers";
import { profiles } from "./identity";

// Recurring weekly availability, stored in the tutor's timezone (converted to
// UTC at query time). weekday: 0 = Sunday.
export const availabilityRules = pgTable(
  "availability_rules",
  {
    id: uuidPk(),
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    weekday: smallint("weekday").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("availability_rules_tutor_idx").on(t.tutorId),
    check("availability_rules_time_chk", sql`${t.endTime} > ${t.startTime}`),
    check("availability_rules_weekday_chk", sql`${t.weekday} between 0 and 6`),
  ],
);

// One-off overrides. is_available=false with null times blocks the whole day.
export const availabilityExceptions = pgTable(
  "availability_exceptions",
  {
    id: uuidPk(),
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    isAvailable: boolean("is_available").notNull(),
    startTime: time("start_time"),
    endTime: time("end_time"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("availability_exceptions_tutor_date_idx").on(t.tutorId, t.date)],
);
