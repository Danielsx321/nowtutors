import { cronHandler } from "@/lib/cron/handler";

/**
 * `GET/POST /api/cron/expire-requests` — the instant-request expiry sweep
 * (SPEC §12, §7.4). Every minute, `pending` rows past `expires_at` become
 * `expired`.
 *
 * WHAT IT IS NOT: the enforcement of expiry. Expiry is enforced at the moment it
 * matters — the accept transaction rejects (and terminally expires) a request
 * past its deadline, and the reads that gate "one pending request at a time"
 * ignore rows past theirs. If this handler failed for an hour, no request could
 * be accepted late and no student would be blocked from sending a new one. What
 * it does is keep the table honest for everything that reads status directly:
 * the tutor's inbox, the student's waiting modal, and an operator's view of
 * what actually happened to a request.
 *
 * Idempotent by construction — the predicate stops matching the rows it just
 * moved, so a double-fire (or a retry) is a no-op returning `expired: 0`.
 *
 * SCHEDULING: Supabase `pg_cron` + `pg_net`, not `vercel.json` — Vercel Hobby
 * runs crons at most once a day, which cannot honour `* * * * *`. Setup SQL:
 * `drizzle/snippets/pg_cron_expire_requests.sql`; steps in `docs/RUNBOOK.md`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The job body lives in `lib/cron/jobs.ts`, shared with the admin "run now"
// button on `/admin/settings` (SPEC §12; Phase 8 Part 4). This file keeps the
// schedule notes, the route config and the HTTP mapping only.
export const GET = cronHandler("expire-requests");

/**
 * Same handler under POST, for the same reason as sweep-presence: §12 and the
 * Vercel-cron convention make it a GET, while `pg_net`'s documented call is
 * `net.http_post`. Both verbs run the identical guarded, idempotent sweep.
 */
export const POST = GET;
