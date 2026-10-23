import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";

/** How long a rate-limit row is kept. The longest window is an hour. */
export const RATE_LIMIT_RETENTION = "1 day";

/**
 * Delete counter rows whose window started more than a day ago (SPEC §12;
 * Security C, 2026-10-22). Run by the daily reconcile-wallets job. Every
 * window is an hour or shorter, so nothing deleted here can still be counting.
 */
export async function deleteExpiredRateLimits(): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    with gone as (
      delete from rate_limits
       where window_start < now() - ${RATE_LIMIT_RETENTION}::interval
      returning 1
    )
    select count(*)::int as n from gone
  `);
  return Number(Array.from(rows)[0]?.n ?? 0);
}
