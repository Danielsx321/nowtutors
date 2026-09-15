import { cronHandler } from "@/lib/cron/handler";

/**
 * `GET/POST /api/cron/release-earnings` — the earnings-release sweep
 * (SPEC §12, §7.11).
 *
 * Every hour: every `tutor_earnings` row that is `held` and whose
 * `available_at` has passed is flipped to `available` and the tutor's wallet is
 * credited `net_credits`, one transaction per row.
 *
 * **This is the only thing in the codebase that pays a tutor for a session.**
 * `complete-sessions` writes the `held` row and touches no wallet (Phase 6 Part
 * 3C); a `held` row is a promise, and the `session_earning` ledger entry written
 * here is the money.
 *
 * A late run costs a tutor nothing but the delay: `available_at` is stored on
 * the row and derived from `ended_at` (§7.11), so nothing about *what* is paid
 * depends on when this runs.
 *
 * SCHEDULING: Supabase `pg_cron` + `pg_net`, hourly, not `vercel.json` — Vercel
 * Hobby runs crons at most once a day (§12). Snippet:
 * `drizzle/snippets/pg_cron_release_earnings.sql`, not run by this pass.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The job body lives in `lib/cron/jobs.ts`, shared with the admin "run now"
// button on `/admin/settings` (SPEC §12; Phase 8 Part 4). This file keeps the
// schedule notes, the route config and the HTTP mapping only.
export const GET = cronHandler("release-earnings");

/**
 * Same handler under POST, for the same reason as the other three crons: §12
 * and the Vercel-cron convention make it a GET, while `pg_net`'s documented
 * call is `net.http_post`. Both verbs run the identical guarded, idempotent
 * sweep.
 */
export const POST = GET;
