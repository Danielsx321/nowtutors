import { index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Attempt counters for the app's rate limits (SPEC §4.7, §5; Security C,
 * 2026-10-22). One row per key per fixed window. The key is
 * `<action>:<ip|email|user>:<value>`, built in `lib/security/rate-limit.ts`;
 * `window_start` is the start of the window the hit fell in.
 *
 * Written only by `public.hit_rate_limit()` (drizzle/0028) on the trusted
 * connection: RLS on, no policies, no anon or authenticated privilege. Rows
 * older than a day are deleted by the daily reconcile-wallets job (§12).
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.windowStart] }),
    index("rate_limits_window_start_idx").on(t.windowStart),
  ],
);
