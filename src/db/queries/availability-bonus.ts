import "server-only";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import {
  auditLog,
  availabilityBonusAwards,
  availabilityBonusMonthlyAwards,
  creditTransactions,
  profiles,
  tutorOnlineTime,
  tutorProfiles,
} from "@/db/schema";
import { walletExecutor, type LedgerExecutor } from "@/lib/credits/ledger";
import type { AvailabilityBonusPort, Qualifier } from "@/lib/availability-bonus/award";
import { daysLeftInMonth, monthEndUtc, monthStartUtc } from "@/lib/availability-bonus/month";

/**
 * Storage for the availability bonus (SPEC §4.4, §7.5, §7.11, §12;
 * availability-bonus 2026-10-14, monthly since 2026-11-15). Two writers and
 * the readers for the tutor and admin pages.
 *
 * Writers: {@link accrueOnlineSeconds} from the heartbeat (inside
 * `touchPresence`'s transaction) and {@link availabilityBonusPort} from the
 * monthly job. Both run as the trusted server; the tables have no client write
 * policy (drizzle/0026).
 */

/**
 * Add `seconds` to a tutor's UTC day bucket. A no-op for zero, so the caller
 * can pass `secondsToAccrue`'s answer straight through.
 */
export async function accrueOnlineSeconds(
  ex: DbTransaction,
  tutorId: string,
  day: string,
  seconds: number,
): Promise<void> {
  if (seconds <= 0) return;
  await ex
    .insert(tutorOnlineTime)
    .values({ tutorId, day, seconds })
    .onConflictDoUpdate({
      target: [tutorOnlineTime.tutorId, tutorOnlineTime.day],
      set: { seconds: sql`${tutorOnlineTime.seconds} + ${seconds}` },
    });
}

/** Live seconds per tutor for one UTC month, approved and unsuspended only. */
function monthSecondsQuery(monthStart: string) {
  return db
    .select({
      tutorId: tutorOnlineTime.tutorId,
      liveSeconds: sql<number>`sum(${tutorOnlineTime.seconds})::int`.as("live_seconds"),
    })
    .from(tutorOnlineTime)
    .innerJoin(tutorProfiles, eq(tutorProfiles.userId, tutorOnlineTime.tutorId))
    .innerJoin(profiles, eq(profiles.id, tutorOnlineTime.tutorId))
    .where(
      and(
        gte(tutorOnlineTime.day, monthStart),
        lte(tutorOnlineTime.day, monthEndUtc(monthStart)),
        eq(tutorProfiles.approvalStatus, "approved"),
        eq(profiles.isSuspended, false),
      ),
    )
    .groupBy(tutorOnlineTime.tutorId);
}

export const availabilityBonusPort: AvailabilityBonusPort = {
  async listQualifiers(monthStart, minSeconds): Promise<Qualifier[]> {
    const monthEnd = monthEndUtc(monthStart);
    const rows = await db
      .select({
        tutorId: tutorOnlineTime.tutorId,
        liveSeconds: sql<number>`sum(${tutorOnlineTime.seconds})::int`,
        // Weekly bonus credits already paid for weeks that START in this month
        // (November 2026 transition; always 0 from December 2026 on).
        weeklyCreditsInMonth: sql<number>`coalesce((
          select sum(w.credits) from ${availabilityBonusAwards} w
          where w.tutor_id = ${tutorOnlineTime.tutorId}
            and w.week_start >= ${monthStart} and w.week_start <= ${monthEnd}
        ), 0)::int`,
      })
      .from(tutorOnlineTime)
      .innerJoin(tutorProfiles, eq(tutorProfiles.userId, tutorOnlineTime.tutorId))
      .innerJoin(profiles, eq(profiles.id, tutorOnlineTime.tutorId))
      .where(
        and(
          gte(tutorOnlineTime.day, monthStart),
          lte(tutorOnlineTime.day, monthEnd),
          eq(tutorProfiles.approvalStatus, "approved"),
          eq(profiles.isSuspended, false),
        ),
      )
      .groupBy(tutorOnlineTime.tutorId)
      .having(
        and(
          gte(sql`sum(${tutorOnlineTime.seconds})`, minSeconds),
          sql`not exists (
            select 1 from ${availabilityBonusMonthlyAwards} a
            where a.tutor_id = ${tutorOnlineTime.tutorId} and a.month_start = ${monthStart}
          )`,
        ),
      );
    return rows.map((r) => ({
      tutorId: r.tutorId,
      liveSeconds: Number(r.liveSeconds),
      weeklyCreditsInMonth: Number(r.weeklyCreditsInMonth),
    }));
  },

  async claimAndCredit(award, credit) {
    return db.transaction(async (tx) => {
      // The award row first: its unique (tutor, month) is the claim. ON CONFLICT
      // DO NOTHING returns no row when another run already holds the month.
      const [row] = await tx
        .insert(availabilityBonusMonthlyAwards)
        .values({
          tutorId: award.tutorId,
          monthStart: award.monthStart,
          liveSeconds: award.liveSeconds,
          credits: award.credits,
          weeklyCreditsDeducted: award.weeklyCreditsDeducted,
        })
        .onConflictDoNothing({
          target: [availabilityBonusMonthlyAwards.tutorId, availabilityBonusMonthlyAwards.monthStart],
        })
        .returning({ id: availabilityBonusMonthlyAwards.id });
      if (!row) return null;

      const out = await credit(row.id, walletExecutor(tx));

      // Record which ledger row paid it (none when the net was 0). The ledger's
      // unique (type, reference_id) means there is at most one.
      const [ledgerRow] = await tx
        .select({ id: creditTransactions.id })
        .from(creditTransactions)
        .where(
          and(
            eq(creditTransactions.type, "availability_bonus"),
            eq(creditTransactions.referenceId, row.id),
          ),
        )
        .limit(1);
      if (ledgerRow) {
        await tx
          .update(availabilityBonusMonthlyAwards)
          .set({ transactionId: ledgerRow.id })
          .where(eq(availabilityBonusMonthlyAwards.id, row.id));
      }
      return out;
    });
  },

  async writeRunAudit(payload) {
    await db.insert(auditLog).values({
      actorId: null,
      action: "bonus.award_run",
      targetType: "availability_bonus",
      targetId: null,
      payload,
    });
  },
};

export type { LedgerExecutor };

/* ---------- Reads for the tutor page ---------- */

export interface TutorMonthProgress {
  monthStart: string;
  liveSeconds: number;
  /** Whole UTC days left in the month, today included. */
  daysLeft: number;
}

/** Live seconds a tutor has so far in the UTC month containing `now`. */
export async function getTutorMonthSeconds(tutorId: string, now: Date = new Date()): Promise<number> {
  const monthStart = monthStartUtc(now);
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${tutorOnlineTime.seconds}), 0)::int` })
    .from(tutorOnlineTime)
    .where(
      and(
        eq(tutorOnlineTime.tutorId, tutorId),
        gte(tutorOnlineTime.day, monthStart),
        lte(tutorOnlineTime.day, monthEndUtc(monthStart)),
      ),
    );
  return Number(row?.total ?? 0);
}

export async function getTutorMonthProgress(
  tutorId: string,
  now: Date = new Date(),
): Promise<TutorMonthProgress> {
  return {
    monthStart: monthStartUtc(now),
    liveSeconds: await getTutorMonthSeconds(tutorId, now),
    daysLeft: daysLeftInMonth(now),
  };
}

export interface TutorMonthlyAward {
  id: string;
  monthStart: string;
  liveSeconds: number;
  credits: number;
  weeklyCreditsDeducted: number;
  createdAt: Date;
}

export async function listTutorMonthlyAwards(tutorId: string, limit = 12): Promise<TutorMonthlyAward[]> {
  return db
    .select({
      id: availabilityBonusMonthlyAwards.id,
      monthStart: availabilityBonusMonthlyAwards.monthStart,
      liveSeconds: availabilityBonusMonthlyAwards.liveSeconds,
      credits: availabilityBonusMonthlyAwards.credits,
      weeklyCreditsDeducted: availabilityBonusMonthlyAwards.weeklyCreditsDeducted,
      createdAt: availabilityBonusMonthlyAwards.createdAt,
    })
    .from(availabilityBonusMonthlyAwards)
    .where(eq(availabilityBonusMonthlyAwards.tutorId, tutorId))
    .orderBy(desc(availabilityBonusMonthlyAwards.monthStart))
    .limit(limit);
}

/* ---------- Reads for the admin page ---------- */

export interface AdminTutorProgress {
  tutorId: string;
  fullName: string | null;
  slug: string;
  liveSeconds: number;
  isLive: boolean;
}

/** Every approved tutor with any live time in the month, most hours first. */
export async function listAdminMonthProgress(monthStart: string): Promise<AdminTutorProgress[]> {
  const sums = monthSecondsQuery(monthStart).as("sums");
  return db
    .select({
      tutorId: sums.tutorId,
      fullName: profiles.fullName,
      slug: tutorProfiles.slug,
      liveSeconds: sums.liveSeconds,
      isLive: tutorProfiles.isLive,
    })
    .from(sums)
    .innerJoin(profiles, eq(profiles.id, sums.tutorId))
    .innerJoin(tutorProfiles, eq(tutorProfiles.userId, sums.tutorId))
    .orderBy(desc(sums.liveSeconds));
}

export interface AdminMonthlyAwardRow {
  id: string;
  monthStart: string;
  tutorId: string;
  fullName: string | null;
  slug: string;
  liveSeconds: number;
  credits: number;
  weeklyCreditsDeducted: number;
  createdAt: Date;
}

/** Monthly awards, newest month first. */
export async function listAdminMonthlyAwards(limit = 200): Promise<AdminMonthlyAwardRow[]> {
  return db
    .select({
      id: availabilityBonusMonthlyAwards.id,
      monthStart: availabilityBonusMonthlyAwards.monthStart,
      tutorId: availabilityBonusMonthlyAwards.tutorId,
      fullName: profiles.fullName,
      slug: tutorProfiles.slug,
      liveSeconds: availabilityBonusMonthlyAwards.liveSeconds,
      credits: availabilityBonusMonthlyAwards.credits,
      weeklyCreditsDeducted: availabilityBonusMonthlyAwards.weeklyCreditsDeducted,
      createdAt: availabilityBonusMonthlyAwards.createdAt,
    })
    .from(availabilityBonusMonthlyAwards)
    .innerJoin(profiles, eq(profiles.id, availabilityBonusMonthlyAwards.tutorId))
    .innerJoin(tutorProfiles, eq(tutorProfiles.userId, availabilityBonusMonthlyAwards.tutorId))
    .orderBy(desc(availabilityBonusMonthlyAwards.monthStart), desc(availabilityBonusMonthlyAwards.createdAt))
    .limit(limit);
}
