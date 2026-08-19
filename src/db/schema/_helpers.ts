import { timestamp, uuid } from "drizzle-orm/pg-core";

// Fresh builder instances per call — Drizzle column builders must not be shared
// across tables. SPEC §4 preamble: uuid PK + created_at/updated_at (UTC).
export const uuidPk = () => uuid("id").primaryKey().defaultRandom();
export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
