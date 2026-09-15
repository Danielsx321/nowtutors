import "server-only";
import * as Sentry from "@sentry/nextjs";
import { sweepStalePresence } from "@/db/queries/presence";
import {
  expirePendingRequests,
  expirePendingRequestsForTutors,
} from "@/db/queries/session-requests";
import { expireUnpaidBookings } from "@/db/queries/expire-unpaid";
import {
  claimAndCreditEarning,
  listDueEarningIds,
} from "@/db/queries/release-earnings";
import { readWalletDrift } from "@/db/queries/reconcile-wallets";
import { pingTokenService } from "@/lib/agora/token-service";
import { runCompleteSessionsSweep } from "@/lib/sessions/complete-sessions";
import { runReleaseEarningsSweep } from "@/lib/earnings/release-earnings";
import { summarizeWalletDrift } from "@/lib/wallets/reconcile";
import type { CronJobName } from "./job-names";

/**
 * The body of every §12 job, in one place (Phase 8 Part 4).
 *
 * Two callers run these: the `app/api/cron/*` routes (the scheduler, behind the
 * bearer guard) and the admin "run now" action on `/admin/settings` (behind
 * `requireRole('admin')`). SPEC §12 says each job is individually invocable from
 * the admin panel; sharing the function is what guarantees "run now" does
 * exactly what the schedule does, rather than a second copy that drifts.
 *
 * The admin path never fetches the cron URL and never sees `CRON_SECRET`: it
 * calls these functions server-side.
 *
 * Every job is idempotent (see each route's header), which is what makes an
 * extra manual run safe. Every job logs its structured summary (§12), whoever
 * triggered it.
 */

export type CronSummary = {
  ok: true;
  job: CronJobName;
  durationMs: number;
} & Record<string, unknown>;

async function sweepPresence(): Promise<CronSummary> {
  const startedAt = Date.now();
  const { sweptUserIds } = await sweepStalePresence();

  // SPEC §7.4: "If the tutor's presence goes stale while a request is pending,
  // the request expires immediately." Deliberately NOT gated on `expires_at`:
  // a tutor who is gone will not answer. Not in one transaction with the sweep
  // above, and it does not need to be: if this failed, expire-requests would
  // still expire every one of those requests at its own deadline.
  const { expiredIds } = await expirePendingRequestsForTutors(sweptUserIds);

  // SPEC §9 cold-start note: the token service sleeps on Render's free tier. One
  // cheap GET on this cadence keeps it awake. `pingTokenService` never throws.
  const agoraPing = await pingTokenService();

  // TODO(Phase 9): end stale broadcasts here — the host going offline should
  // close the broadcast the same way it expires their pending requests.

  const summary = {
    ok: true as const,
    job: "sweep-presence" as const,
    swept: sweptUserIds.length,
    sweptUserIds,
    pendingRequestsExpired: expiredIds.length,
    agoraWarmPing: agoraPing,
    durationMs: Date.now() - startedAt,
  };
  console.info("[cron/sweep-presence]", JSON.stringify(summary));
  return summary;
}

async function expireRequests(): Promise<CronSummary> {
  const startedAt = Date.now();
  const { expiredIds } = await expirePendingRequests();
  const summary = {
    ok: true as const,
    job: "expire-requests" as const,
    expired: expiredIds.length,
    expiredIds,
    durationMs: Date.now() - startedAt,
  };
  console.info("[cron/expire-requests]", JSON.stringify(summary));
  return summary;
}

async function expireUnpaid(): Promise<CronSummary> {
  const startedAt = Date.now();
  const { expiredIds } = await expireUnpaidBookings();
  const summary = {
    ok: true as const,
    job: "expire-unpaid" as const,
    expired: expiredIds.length,
    expiredIds,
    durationMs: Date.now() - startedAt,
  };
  console.info("[cron/expire-unpaid]", JSON.stringify(summary));
  return summary;
}

async function completeSessions(): Promise<CronSummary> {
  const startedAt = Date.now();
  const {
    completedIds,
    noShowTutorIds,
    noShowStudentIds,
    earningsCreatedIds,
    earningsSkippedNoPriceIds,
  } = await runCompleteSessionsSweep();

  const summary = {
    ok: true as const,
    job: "complete-sessions" as const,
    completed: completedIds.length,
    noShowTutor: noShowTutorIds.length,
    noShowStudent: noShowStudentIds.length,
    // What the database did, not what this run intended: on a retry the rows
    // are already classified and this is 0.
    earningsCreated: earningsCreatedIds.length,
    // A payout-earning booking whose price_credits was NULL: no earnings row
    // was written for it (a zero-credit one would permanently occupy the
    // UNIQUE booking_id slot), only logged. Should be 0 in steady state.
    earningsSkippedNoPrice: earningsSkippedNoPriceIds.length,
    completedIds,
    noShowTutorIds,
    noShowStudentIds,
    earningsCreatedIds,
    earningsSkippedNoPriceIds,
    durationMs: Date.now() - startedAt,
  };
  console.info("[cron/complete-sessions]", JSON.stringify(summary));
  return summary;
}

async function releaseEarnings(): Promise<CronSummary> {
  const startedAt = Date.now();
  const {
    releasedIds,
    creditsReleased,
    notClaimedIds,
    corruptSplitIds,
    duplicateLedgerIds,
    failedIds,
  } = await runReleaseEarningsSweep({ listDueEarningIds, claimAndCreditEarning });

  const summary = {
    ok: true as const,
    job: "release-earnings" as const,
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
  console.info("[cron/release-earnings]", JSON.stringify(summary));
  return summary;
}

async function reconcileWallets(): Promise<CronSummary> {
  const startedAt = Date.now();
  const { walletsChecked, rows } = await readWalletDrift();
  const found = summarizeWalletDrift(walletsChecked, rows);

  const summary = {
    ok: true as const,
    job: "reconcile-wallets" as const,
    drift: found.mismatches > 0,
    ...found,
    durationMs: Date.now() - startedAt,
  };

  // Drift is a finding, not a failure: the caller still gets `ok: true`. The
  // alarm is this error line plus the Sentry event, whoever triggered the run.
  if (summary.drift) {
    console.error("[cron/reconcile-wallets] WALLET DRIFT", JSON.stringify(summary));
    Sentry.captureMessage("reconcile-wallets: wallet balance does not match the ledger", {
      level: "error",
      extra: summary,
    });
  } else {
    console.info("[cron/reconcile-wallets]", JSON.stringify(summary));
  }
  return summary;
}

const JOBS: Record<CronJobName, { run: () => Promise<CronSummary>; failureMessage: string }> = {
  "sweep-presence": { run: sweepPresence, failureMessage: "Sweep failed." },
  "expire-requests": { run: expireRequests, failureMessage: "Expiry sweep failed." },
  "expire-unpaid": { run: expireUnpaid, failureMessage: "Unpaid-booking expiry failed." },
  "complete-sessions": { run: completeSessions, failureMessage: "Completion sweep failed." },
  "release-earnings": { run: releaseEarnings, failureMessage: "Earnings release failed." },
  "reconcile-wallets": { run: reconcileWallets, failureMessage: "Wallet reconciliation failed." },
};

export function runCronJob(job: CronJobName): Promise<CronSummary> {
  return JOBS[job].run();
}

/** The public, detail-free message for a job that threw. */
export function cronFailureMessage(job: CronJobName): string {
  return JOBS[job].failureMessage;
}

/**
 * Log a job that threw. `reconcile-wallets` also reports to Sentry: a nightly
 * alarm that silently stops running is the failure worth being paged for.
 */
export function reportCronFailure(job: CronJobName, err: unknown): void {
  console.error(`[cron/${job}] failed`, err);
  if (job === "reconcile-wallets") Sentry.captureException(err);
}
