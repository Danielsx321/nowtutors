import { NextResponse } from "next/server";
import { cronAuthFailure } from "@/lib/auth/api-guards";
import { runCompleteSessionsSweep } from "@/lib/sessions/complete-sessions";

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
 * THIS HANDLER DOES NOT TOUCH A WALLET. No `creditWallet`, no
 * `credit_transactions` row, nothing from `lib/credits/ledger.ts` is imported
 * anywhere on this path. A `held` earnings row is a promise; the ledger entry is
 * the money, and it is written when `release-earnings` flips `held` →
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

export async function GET(request: Request) {
  const denied = cronAuthFailure(request, "complete-sessions");
  if (denied) return denied;

  const startedAt = Date.now();
  try {
    const {
      completedIds,
      noShowTutorIds,
      noShowStudentIds,
      earningsCreatedIds,
    } = await runCompleteSessionsSweep();

    const summary = {
      ok: true as const,
      job: "complete-sessions",
      completed: completedIds.length,
      noShowTutor: noShowTutorIds.length,
      noShowStudent: noShowStudentIds.length,
      // What the database did, not what this run intended: on a retry the rows
      // are already classified and this is 0.
      earningsCreated: earningsCreatedIds.length,
      completedIds,
      noShowTutorIds,
      noShowStudentIds,
      earningsCreatedIds,
      durationMs: Date.now() - startedAt,
    };
    // §12: every cron handler logs a structured summary of what it changed.
    console.info("[cron/complete-sessions]", JSON.stringify(summary));
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[cron/complete-sessions] failed", err);
    return NextResponse.json(
      { error: "Completion sweep failed." },
      { status: 500 },
    );
  }
}

/**
 * Same handler under POST, for the same reason as the other two crons: §12 and
 * the Vercel-cron convention make it a GET, while `pg_net`'s documented call is
 * `net.http_post`. Both verbs run the identical guarded, idempotent sweep.
 */
export const POST = GET;
