import { NextResponse } from "next/server";
import { cronAuthFailure } from "@/lib/auth/api-guards";
import {
  claimAndCreditEarning,
  listDueEarningIds,
} from "@/db/queries/release-earnings";
import { runReleaseEarningsSweep } from "@/lib/earnings/release-earnings";

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

export async function GET(request: Request) {
  const denied = cronAuthFailure(request, "release-earnings");
  if (denied) return denied;

  const startedAt = Date.now();
  try {
    const {
      releasedIds,
      creditsReleased,
      notClaimedIds,
      corruptSplitIds,
      duplicateLedgerIds,
      failedIds,
    } = await runReleaseEarningsSweep({
      listDueEarningIds,
      claimAndCreditEarning,
    });

    const summary = {
      ok: true as const,
      job: "release-earnings",
      // What the database did, not what this run intended: on a second run
      // inside the same hour these are 0.
      released: releasedIds.length,
      creditsReleased,
      // Claimed by an overlapping run, or no longer due. Not an error.
      notClaimed: notClaimedIds.length,
      // net + fee != gross. Left `held`, paid nothing, needs a person.
      corruptSplit: corruptSplitIds.length,
      // A `session_earning` already existed for that booking (§4.4's unique
      // index refused it). Left `held`. Should be 0 in steady state.
      duplicateLedger: duplicateLedgerIds.length,
      // Anything else that threw. Should be 0 in steady state.
      failed: failedIds.length,
      releasedIds,
      notClaimedIds,
      corruptSplitIds,
      duplicateLedgerIds,
      failedIds,
      durationMs: Date.now() - startedAt,
    };
    // §12: every cron handler logs a structured summary of what it changed.
    console.info("[cron/release-earnings]", JSON.stringify(summary));
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[cron/release-earnings] failed", err);
    return NextResponse.json(
      { error: "Earnings release failed." },
      { status: 500 },
    );
  }
}

/**
 * Same handler under POST, for the same reason as the other three crons: §12
 * and the Vercel-cron convention make it a GET, while `pg_net`'s documented
 * call is `net.http_post`. Both verbs run the identical guarded, idempotent
 * sweep.
 */
export const POST = GET;
