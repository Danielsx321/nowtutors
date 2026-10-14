import { cronHandler } from "@/lib/cron/handler";

/**
 * `GET/POST /api/cron/availability-bonus` — the weekly availability bonus
 * (SPEC §7.5, §7.11, §12; availability-bonus, 2026-10-14).
 *
 * Every approved, unsuspended tutor who was live for the threshold
 * (`availability_bonus_min_hours`, seeded 5) in a complete Monday-to-Sunday
 * UTC week is credited `availability_bonus_credits` (seeded 40) through the
 * ledger, once per week, and emailed. The job checks the last four complete
 * weeks, so a Monday the scheduler missed is paid on the next run.
 *
 * **Idempotent by two unique indexes**: `availability_bonus_awards (tutor,
 * week)` and the ledger's `(type, reference_id)` where the reference is the
 * award id. A second run of the same week pays nobody twice.
 *
 * SCHEDULING: Supabase `pg_cron` + `pg_net`, Mondays at 00:20 UTC (§12).
 * Snippet: `drizzle/snippets/pg_cron_availability_bonus.sql`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The job body lives in `lib/cron/jobs.ts`, shared with the admin "run now"
// button on `/admin/settings` and `/admin/availability`.
export const GET = cronHandler("availability-bonus");

/** Same handler under POST: `pg_net`'s documented call is `net.http_post`. */
export const POST = GET;
