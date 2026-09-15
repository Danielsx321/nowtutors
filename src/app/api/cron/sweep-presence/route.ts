import { cronHandler } from "@/lib/cron/handler";

/**
 * `GET /api/cron/sweep-presence` — the presence staleness sweep (SPEC §7.5
 * defence 2, §12).
 *
 * WHAT IT IS NOT: correctness. Students are protected by the `live_tutors` view
 * at read time (§3.1), so if this handler fails for an hour nobody sees a stale
 * live tutor. This sweep tidies the underlying `tutor_profiles` rows — which
 * keeps `is_live` honest for anything that legitimately reads the base table
 * (admin views, the tutor's own toggle state) and stops the flag drifting
 * permanently true after an ungraceful exit.
 *
 * THE WORK SET COMES FROM THE VIEW. Rows are swept where `is_live = true` and
 * the row is absent from `live_tutors` — the view already encodes what "still
 * live" means, so the sweep does not carry a threshold of its own. There is no
 * `presence_stale_seconds` setting: a second tunable definition of stale is
 * precisely the drift §3.1 exists to prevent (see `db/queries/presence.ts`).
 *
 * Idempotent by construction — the predicate stops matching the rows it just
 * cleared, so a double-fire (or a retry) is a no-op returning `swept: 0`.
 *
 * SCHEDULING: Vercel Hobby only permits once-daily crons, which is useless for a
 * 5-minute sweep, so this route is driven by Supabase `pg_cron` + `pg_net`
 * posting to it with the bearer header. There is deliberately no `vercel.json`.
 * Setup SQL: `drizzle/snippets/pg_cron_sweep_presence.sql`; steps in
 * `docs/RUNBOOK.md`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The job body lives in `lib/cron/jobs.ts`, shared with the admin "run now"
// button on `/admin/settings` (SPEC §12; Phase 8 Part 4). This file keeps the
// schedule notes, the route config and the HTTP mapping only.
export const GET = cronHandler("sweep-presence");

/**
 * Same handler under POST. SPEC §12 and the Vercel-cron convention make this a
 * GET route, but the scheduler that actually drives it is Supabase `pg_net`,
 * whose documented call for this is `net.http_post`. Rather than pick one and
 * leave the other silently 405-ing, both verbs run the identical guarded,
 * idempotent sweep. There is no body to read in either case.
 */
export const POST = GET;
