import { cronHandler } from "@/lib/cron/handler";

/**
 * `GET/POST /api/cron/complete-sessions` — the session-completion sweep
 * (SPEC §12, §7.11, §7.4).
 *
 * Every fifteen minutes: close the sessions whose clock has run out, classify
 * the ones nobody attended, and write the tutor's `held` earnings row for each
 * one that pays.
 *
 * WHAT IT IS NOT: the enforcement of the hard stop. Four server-side actors
 * already end an elapsed session while somebody is in the room (Part 3B:
 * `getSessionState`, the token route, the end-session action, and the room's
 * server read, which refuses but deliberately does not write). This handler is
 * what closes the case where **both parties walked away** — nobody is present,
 * so nothing else is going to fire — and it is the only writer of
 * `tutor_earnings` in the codebase today.
 *
 * A late run costs a tutor nothing. `ended_at` records when the session ended,
 * not when this noticed: the instant path writes `started_at + duration_minutes`
 * through the shipped, capped statement, and the scheduled path writes
 * `scheduled_end_at`. §7.11 derives `available_at` from `ended_at`, so an hour
 * of this job failing moves nobody's withdrawal date (docs/DECISIONS.md,
 * "`ended_at` is capped at the deadline").
 *
 * THIS HANDLER CALLS NOTHING FROM THE LEDGER AND WRITES NO WALLET. No
 * `creditWallet`, no `debitWallet`, no `credit_transactions` row — nothing on
 * this path touches a wallet. **`lib/credits/ledger.ts` IS in the transitive
 * import closure**, though (`db/queries/sessions.ts` imports `sessionChannel`
 * from `lib/session-requests/accept.ts`, which value-imports `debitWallet`,
 * pre-existing from Part 3B) — so "not imported" is not the guarantee here;
 * "calls nothing from it" is. A `held` earnings row is a promise; the ledger
 * entry is the money, and it is written when `release-earnings` flips `held` →
 * `available` (Phase 8). Crediting `wallets.credit_balance` here would put
 * credits a tutor cannot yet withdraw into the number that means "credits you
 * can spend or withdraw".
 *
 * Idempotent twice over, which is deliberate rather than redundant: every
 * predicate moves its rows out of the status it matches on, **and**
 * `tutor_earnings.booking_id` is UNIQUE with `ON CONFLICT DO NOTHING`. The first
 * makes a second run a no-op; the second makes it impossible to double-pay even
 * through the window between a transition committing and its earnings insert.
 *
 * SCHEDULING: Supabase `pg_cron` + `pg_net`, every 15 minutes, not `vercel.json`
 * — Vercel Hobby runs crons at most once a day (§12). The snippet and the
 * RUNBOOK step are **not** in this pass: scheduling is gated on the CRON_SECRET
 * rotation, which is still open. The route is complete and callable without it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The job body lives in `lib/cron/jobs.ts`, shared with the admin "run now"
// button on `/admin/settings` (SPEC §12; Phase 8 Part 4). This file keeps the
// schedule notes, the route config and the HTTP mapping only.
export const GET = cronHandler("complete-sessions");

/**
 * Same handler under POST, for the same reason as the other two crons: §12 and
 * the Vercel-cron convention make it a GET, while `pg_net`'s documented call is
 * `net.http_post`. Both verbs run the identical guarded, idempotent sweep.
 */
export const POST = GET;
