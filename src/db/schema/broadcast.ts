import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, updatedAt, uuidPk } from "./_helpers";
import { broadcastStatus } from "./enums";
import { profiles, subjects } from "./identity";

// NET-NEW (not Bubble parity) — one-to-many live teaching (SPEC §7.8).
export const broadcasts = pgTable(
  "broadcasts",
  {
    id: uuidPk(),
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    title: text("title"),
    description: text("description"),
    subjectId: uuid("subject_id").references(() => subjects.id),
    // `broadcast_{id}`, written in SQL at insert (db/queries/broadcasts.ts).
    // No client can write this table (drizzle/0018), so no client names it.
    agoraChannel: text("agora_channel").notNull().unique(),
    status: broadcastStatus("status").notNull().default("live"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    peakViewers: integer("peak_viewers").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // Phase 9 Part 3 (drizzle/0020): one live broadcast per tutor. The start
  // transaction checks first under the tutor row lock; the index is what makes
  // a double start impossible rather than merely unlikely.
  (t) => [
    uniqueIndex("broadcasts_one_live_per_tutor")
      .on(t.tutorId)
      .where(sql`status = 'live'`),
  ],
);

// user_id nullable in the schema, but only ever written for a signed-in viewer,
// by the token route (SPEC §4.6: watching requires sign-in).
export const broadcastViewers = pgTable(
  "broadcast_viewers",
  {
    id: uuidPk(),
    broadcastId: uuid("broadcast_id")
      .notNull()
      .references(() => broadcasts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => profiles.id),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("broadcast_viewers_broadcast_idx").on(t.broadcastId)],
);
