import { pgTable, uuid, timestamp } from "drizzle-orm/pg-core";

// Phase 0 pipeline probe only — its sole purpose is to exercise
// db:generate / db:migrate end to end. The real Section 4 schema lands in
// Phase 1; this table can be dropped then.
export const healthCheck = pgTable("health_check", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
