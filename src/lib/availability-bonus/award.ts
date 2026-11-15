import {
  creditWallet,
  DuplicateLedgerReferenceError,
  type LedgerExecutor,
} from "@/lib/credits/ledger";
import { formatMonth, recentCompleteMonthStarts } from "./month";

/**
 * The `availability-bonus` job (SPEC §12, §7.5, §7.11; monthly-availability-bonus,
 * 2026-11-15): on the 1st of every month, credit each approved tutor who was
 * live for the threshold (20 hours) in the month that just ended. Paying only
 * after the month ends is the rule: the bonus cannot be withdrawn before then
 * because it is not in the wallet before then. Session earnings are untouched.
 *
 * Shaped like `release-earnings`: a pure core over a storage port, so the
 * money decisions are testable against the in-memory ledger without Postgres.
 * The production port is `db/queries/availability-bonus.ts`.
 *
 * **Exactly once, by construction.** The port's `claimAndCredit` inserts the
 * award row (unique per tutor and month) and the ledger row (unique per type
 * and award id) in ONE transaction. A second run of the same month either
 * finds no qualifiers left (the listing excludes awarded months) or, in a
 * race, hits one of the two unique indexes and rolls back.
 *
 * **Self-healing, with a floor.** The job looks at the last `MONTHS_TO_CHECK`
 * complete months, so a 1st the scheduler missed is paid on the next run. It
 * never looks before `FIRST_BONUS_MONTH`: months before November 2026 were
 * under the weekly rule and are settled.
 *
 * **November 2026 transition.** Weekly bonuses were paid for weeks starting
 * in November before the rule changed. Those credits come off the monthly
 * award (`weeklyCreditsInMonth`), floored at zero, and nothing already paid is
 * taken back. From December on no weekly rows can exist, so the deduction is 0.
 */

export const MONTHS_TO_CHECK = 3;

/** Monthly rule decided 15 Nov 2026 (Noora, via Daniels). Never pay a month before it. */
export const FIRST_BONUS_MONTH = "2026-11-01";

export interface AvailabilityBonusSettings {
  enabled: boolean;
  minHours: number;
  credits: number;
}

export interface Qualifier {
  tutorId: string;
  liveSeconds: number;
  /** Credits paid by the old weekly bonus for weeks starting inside this month. */
  weeklyCreditsInMonth: number;
}

export interface AwardedRow {
  awardId: string;
  tutorId: string;
  monthStart: string;
  liveSeconds: number;
  /** Net credits paid. */
  credits: number;
  weeklyCreditsDeducted: number;
}

export interface MonthlyAwardClaim {
  tutorId: string;
  monthStart: string;
  liveSeconds: number;
  credits: number;
  weeklyCreditsDeducted: number;
}

export interface AvailabilityBonusPort {
  /**
   * Approved, unsuspended tutors with `minSeconds` or more live seconds in the
   * month starting `monthStart`, who have no monthly award row for it yet. A
   * work list; the claim below restates "no award yet" with a unique index.
   */
  listQualifiers(monthStart: string, minSeconds: number): Promise<Qualifier[]>;
  /**
   * One transaction: insert the award row, then run `credit` with an executor
   * bound to that transaction, then record the ledger row id on the award (if
   * one was written). `null` when the award row already existed. A throw from
   * `credit` must roll the award row back.
   */
  claimAndCredit<T>(
    award: MonthlyAwardClaim,
    credit: (awardId: string, ex: LedgerExecutor) => Promise<T>,
  ): Promise<T | null>;
  /** One audit row per run, actor null. Never throws into the job. */
  writeRunAudit(payload: Record<string, unknown>): Promise<void>;
}

export interface AvailabilityBonusResult {
  /** The months this run looked at, oldest first. */
  monthsChecked: string[];
  /** Awards that moved credits (net > 0); the email list. */
  awarded: AwardedRow[];
  creditsAwarded: number;
  /** Weekly credits taken off the awards in this run. */
  weeklyDeducted: number;
  /** Months settled with a net of 0 because weekly credits already covered them. */
  settledZero: number;
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
  const monthsChecked = recentCompleteMonthStarts(now, MONTHS_TO_CHECK, FIRST_BONUS_MONTH);
  const result: AvailabilityBonusResult = {
    monthsChecked,
    awarded: [],
    creditsAwarded: 0,
    weeklyDeducted: 0,
    settledZero: 0,
    alreadyAwarded: 0,
    duplicateLedger: 0,
    failed: 0,
    disabled: !settings.enabled,
  };
  if (!settings.enabled) return result;

  const minSeconds = Math.round(settings.minHours * 3600);

  for (const monthStart of monthsChecked) {
    for (const q of await port.listQualifiers(monthStart, minSeconds)) {
      const deducted = Math.min(settings.credits, Math.max(0, q.weeklyCreditsInMonth));
      const net = settings.credits - deducted;
      // Per tutor, every failure caught here: one bad row must not cost every
      // other tutor on this run their bonus.
      try {
        const awardId = await port.claimAndCredit(
          {
            tutorId: q.tutorId,
            monthStart,
            liveSeconds: q.liveSeconds,
            credits: net,
            weeklyCreditsDeducted: deducted,
          },
          async (awardId, ex) => {
            if (net > 0) {
              await creditWallet(ex, {
                userId: q.tutorId,
                delta: net,
                type: "availability_bonus",
                referenceType: "availability_bonus",
                referenceId: awardId,
                description: `Monthly availability bonus, ${formatMonth(monthStart)}`,
              });
            }
            return awardId;
          },
        );
        if (awardId === null) {
          result.alreadyAwarded++;
          continue;
        }
        result.weeklyDeducted += deducted;
        if (net === 0) {
          result.settledZero++;
          continue;
        }
        result.awarded.push({
          awardId,
          tutorId: q.tutorId,
          monthStart,
          liveSeconds: q.liveSeconds,
          credits: net,
          weeklyCreditsDeducted: deducted,
        });
        result.creditsAwarded += net;
      } catch (err) {
        if (err instanceof DuplicateLedgerReferenceError) {
          console.error(`[cron/availability-bonus] ${q.tutorId} ${monthStart}: ledger row already exists`);
          result.duplicateLedger++;
          continue;
        }
        console.error(`[cron/availability-bonus] ${q.tutorId} ${monthStart} failed`, err);
        result.failed++;
      }
    }
  }

  try {
    await port.writeRunAudit({
      months: monthsChecked,
      awarded: result.awarded.length,
      credits_each: settings.credits,
      credits_total: result.creditsAwarded,
      weekly_deducted_total: result.weeklyDeducted,
      settled_zero: result.settledZero,
      min_hours: settings.minHours,
      already_awarded: result.alreadyAwarded,
      failed: result.failed,
    });
  } catch (err) {
    console.error("[cron/availability-bonus] audit row failed", err);
  }

  return result;
}
