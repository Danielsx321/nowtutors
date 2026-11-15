import { cronHandler } from "@/lib/cron/handler";

/**
 * `GET/POST /api/cron/availability-bonus` — the monthly availability bonus
 * (SPEC §7.5, §7.11, §12; availability-bonus 2026-10-14, monthly since
 * 2026-11-15).
 *
 * Every approved, unsuspended tutor who was live for the threshold
 * (`availability_bonus_min_hours`, seeded 20) in a complete UTC calendar month
 * is credited `availability_bonus_credits` (seeded 100) through the ledger,
 * once per month, and emailed. The job checks the last three complete months
 * (never before November 2026), so a 1st the scheduler missed is paid on the
 * next run.
 *
 * **Idempotent by two unique indexes**: `availability_bonus_monthly_awards
 * (tutor, month)` and the ledger's `(type, reference_id)` where the reference
 * is the award id. A second run of the same month pays nobody twice.
 *
 * SCHEDULING: Supabase `pg_cron` + `pg_net`, the 1st of each month at 00:20 UTC
 * (§12). Snippet: `drizzle/snippets/pg_cron_availability_bonus.sql`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The job body lives in `lib/cron/jobs.ts`, shared with the admin "run now"
// button on `/admin/settings` and `/admin/availability`.
export const GET = cronHandler("availability-bonus");

/** Same handler under POST: `pg_net`'s documented call is `net.http_post`. */
export const POST = GET;
