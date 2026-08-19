import { jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, updatedAt, uuidPk } from "./_helpers";
import { profiles } from "./identity";

// Admin-editable settings; anyone may read (pricing display). presence_stale_seconds
// is intentionally absent (Decision #8 — threshold baked into the live_tutors view).
export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  description: text("description"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Append-only (no updated_at). Every admin mutation writes here.
export const auditLog = pgTable("audit_log", {
  id: uuidPk(),
  actorId: uuid("actor_id").references(() => profiles.id),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: uuid("target_id"),
  payload: jsonb("payload"),
  ip: text("ip"),
  createdAt: createdAt(),
});
