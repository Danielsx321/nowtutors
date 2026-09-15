import { cronHandler } from "@/lib/cron/handler";

/**
 * `GET/POST /api/cron/expire-unpaid` — abandoned direct-pay checkouts become
 * `expired` (SPEC §4.2, §12; Phase 8 Part 3).
 *
 * WHAT IT IS NOT: what releases the slot. `computeSlots` releases a stale hold on
 * read and the booking transaction expires one it collides with on write, so an
 * hour of this job failing double-sells nothing. See
 * `db/queries/expire-unpaid.ts` for the boundary and the late-capture case.
 *
 * SCHEDULING: Supabase `pg_cron` + `pg_net`, every 10 minutes (§12). Snippet:
 * `drizzle/snippets/pg_cron_expire_unpaid.sql`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The job body lives in `lib/cron/jobs.ts`, shared with the admin "run now"
// button on `/admin/settings` (SPEC §12; Phase 8 Part 4). This file keeps the
// schedule notes, the route config and the HTTP mapping only.
export const GET = cronHandler("expire-unpaid");

/** Same handler under POST: `pg_net`'s documented call is `net.http_post`. */
export const POST = GET;
