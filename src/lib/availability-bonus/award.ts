import {
  creditWallet,
  DuplicateLedgerReferenceError,
  type LedgerExecutor,
} from "@/lib/credits/ledger";
import { recentCompleteWeekStarts } from "./week";

/**
 * The `availability-bonus` job (SPEC §12, §7.5, §7.11; availability-bonus,
 * 2026-10-14): every Monday, credit each approved tutor who was live for the
 * threshold in the week that just ended.
 *
 * Shaped like `release-earnings`: a pure core over a storage port, so the
 * money decisions are testable against the in-memory ledger without Postgres.
 * The production port is `db/queries/availability-bonus.ts`.
 *
 * **Exactly once, by construction.** The port's `claimAndCredit` inserts the
 * award row (unique per tutor and week) and the ledger row (unique per type
 * and award id) in ONE transaction. A second run of the same week either
 * finds no qualifiers left (the listing excludes awarded weeks) or, in a
 * race, hits one of the two unique indexes and rolls back. Nothing here keeps
 * state of its own.
 *
 * **Self-healing.** The job looks at the last `WEEKS_TO_CHECK` complete weeks,
 * not just the previous one, so a Monday the scheduler missed is paid on the
 * next run instead of needing a person to notice.
 */

export const WEEKS_TO_CHECK = 4;

export interface AvailabilityBonusSettings {
  enabled: boolean;
  minHours: number;
  credits: number;
}

export interface Qualifier {
  tutorId: string;
  liveSeconds: number;
}

export interface AwardedRow {
  awardId: string;
  tutorId: string;
  weekStart: string;
  liveSeconds: number;
  credits: number;
}

export interface AvailabilityBonusPort {
  /**
   * Approved, unsuspended tutors with `minSeconds` or more live seconds in the
   * week starting `weekStart`, who have no award row for it yet. A work list;
   * the claim below restates the "no award yet" rule with a unique index.
   */
  listQualifiers(weekStart: string, minSeconds: number): Promise<Qualifier[]>;
  /**
   * One transaction: insert the award row, then run `credit` with an executor
   * bound to that transaction, then record the ledger row id on the award.
   * `null` when the award row already existed (another run got there first).
   * A throw from `credit` must roll the award row back.
   */
  claimAndCredit<T>(
    award: { tutorId: string; weekStart: string; liveSeconds: number; credits: number },
    credit: (awardId: string, ex: LedgerExecutor) => Promise<T>,
  ): Promise<T | null>;
  /** One audit row per run, actor null. Never throws into the job. */
  writeRunAudit(payload: Record<string, unknown>): Promise<void>;
}

export interface AvailabilityBonusResult {
  /** The weeks this run looked at, oldest first. */
  weeksChecked: string[];
  awarded: AwardedRow[];
  creditsAwarded: number;
  /** Listed, but the award row already existed when we tried. Expected under concurrency. */
  alreadyAwarded: number;
  /** The ledger refused a second credit for an award id. Should be 0. */
  duplicateLedger: number;
  /** Anything else that threw. Logged with the tutor id; the batch continues. */
  failed: number;
  disabled: boolean;
}

export async function runAvailabilityBonus(
  port: AvailabilityBonusPort,
  settings: AvailabilityBonusSettings,
  now: Date = new Date(),
): Promise<AvailabilityBonusResult> {
  const weeksChecked = recentCompleteWeekStarts(now, WEEKS_TO_CHECK);
  const result: AvailabilityBonusResult = {
    weeksChecked,
    awarded: [],
    creditsAwarded: 0,
    alreadyAwarded: 0,
    duplicateLedger: 0,
    failed: 0,
    disabled: !settings.enabled,
  };
  if (!settings.enabled) return result;

  const minSeconds = Math.round(settings.minHours * 3600);

  for (const weekStart of weeksChecked) {
    for (const q of await port.listQualifiers(weekStart, minSeconds)) {
      // Per tutor, every failure caught here: one bad row must not cost every
      // other tutor on this run their bonus.
      try {
        const awardId = await port.claimAndCredit(
          { tutorId: q.tutorId, weekStart, liveSeconds: q.liveSeconds, credits: settings.credits },
          async (awardId, ex) => {
            await creditWallet(ex, {
              userId: q.tutorId,
              delta: settings.credits,
              type: "availability_bonus",
              referenceType: "availability_bonus",
              referenceId: awardId,
              description: `Weekly availability bonus, week of ${weekStart}`,
            });
            return awardId;
          },
        );
        if (awardId === null) {
          result.alreadyAwarded++;
          continue;
        }
        result.awarded.push({
          awardId,
          tutorId: q.tutorId,
          weekStart,
          liveSeconds: q.liveSeconds,
          credits: settings.credits,
        });
        result.creditsAwarded += settings.credits;
      } catch (err) {
        if (err instanceof DuplicateLedgerReferenceError) {
          console.error(`[cron/availability-bonus] ${q.tutorId} ${weekStart}: ledger row already exists`);
          result.duplicateLedger++;
          continue;
        }
        console.error(`[cron/availability-bonus] ${q.tutorId} ${weekStart} failed`, err);
        result.failed++;
      }
    }
  }

  try {
    await port.writeRunAudit({
      weeks: weeksChecked,
      awarded: result.awarded.length,
      credits_each: settings.credits,
      credits_total: result.creditsAwarded,
      min_hours: settings.minHours,
      already_awarded: result.alreadyAwarded,
      failed: result.failed,
    });
  } catch (err) {
    console.error("[cron/availability-bonus] audit row failed", err);
  }

  return result;
}
