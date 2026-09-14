import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { cronAuthFailure } from "@/lib/auth/api-guards";
import { readWalletDrift } from "@/db/queries/reconcile-wallets";
import { summarizeWalletDrift } from "@/lib/wallets/reconcile";

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

export async function GET(request: Request) {
  const denied = cronAuthFailure(request, "reconcile-wallets");
  if (denied) return denied;

  const startedAt = Date.now();
  try {
    const { walletsChecked, rows } = await readWalletDrift();
    const found = summarizeWalletDrift(walletsChecked, rows);

    const summary = {
      ok: true as const,
      job: "reconcile-wallets",
      drift: found.mismatches > 0,
      ...found,
      durationMs: Date.now() - startedAt,
    };

    if (summary.drift) {
      console.error("[cron/reconcile-wallets] WALLET DRIFT", JSON.stringify(summary));
      Sentry.captureMessage("reconcile-wallets: wallet balance does not match the ledger", {
        level: "error",
        extra: summary,
      });
    } else {
      // §12: every cron handler logs a structured summary of what it found.
      console.info("[cron/reconcile-wallets]", JSON.stringify(summary));
    }
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[cron/reconcile-wallets] failed", err);
    Sentry.captureException(err);
    return NextResponse.json({ error: "Wallet reconciliation failed." }, { status: 500 });
  }
}

/** Same handler under POST: `pg_net`'s documented call is `net.http_post`. */
export const POST = GET;
