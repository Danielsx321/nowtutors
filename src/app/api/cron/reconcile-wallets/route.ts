import { cronHandler } from "@/lib/cron/handler";

/**
 * `GET/POST /api/cron/reconcile-wallets` — the nightly drift alarm (SPEC §4.4,
 * §12; Phase 8 Part 3).
 *
 * Asserts `wallets.credit_balance = sum(credit_transactions.delta)` for every
 * user. **Reports, never repairs** (see `lib/wallets/reconcile.ts`).
 *
 * **A mismatch is a finding, not a failure of the job.** The route still answers
 * 200 with `ok: true` and `drift: true`, so `cron.job_run_details` keeps meaning
 * "the job ran". The alarm is the Sentry error event plus a `console.error`
 * line. Only a job that could not read the database answers 500.
 *
 * Sentry is a no-op when `SENTRY_DSN` is unset (`instrumentation.ts`); the log
 * line and the stored `net._http_response` body carry the same finding either
 * way.
 *
 * SCHEDULING: Supabase `pg_cron` + `pg_net`, daily at 03:00 UTC (§12). Snippet:
 * `drizzle/snippets/pg_cron_reconcile_wallets.sql`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The job body lives in `lib/cron/jobs.ts`, shared with the admin "run now"
// button on `/admin/settings` (SPEC §12; Phase 8 Part 4). This file keeps the
// schedule notes, the route config and the HTTP mapping only.
export const GET = cronHandler("reconcile-wallets");

/** Same handler under POST: `pg_net`'s documented call is `net.http_post`. */
export const POST = GET;
