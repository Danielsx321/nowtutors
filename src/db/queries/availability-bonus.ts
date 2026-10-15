import "server-only";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import {
  auditLog,
  availabilityBonusAwards,
  creditTransactions,
  profiles,
  tutorOnlineTime,
  tutorProfiles,
} from "@/db/schema";
import { walletExecutor, type LedgerExecutor } from "@/lib/credits/ledger";
import type { AvailabilityBonusPort, Qualifier } from "@/lib/availability-bonus/award";
import { utcDayOf, weekEndUtc, weekStartUtc } from "@/lib/availability-bonus/week";

/**
 * Storage for the weekly availability bonus (SPEC §4.4, §7.5, §7.11, §12;
 * availability-bonus, 2026-10-14). Two writers and four readers.
 *
 * Writers: {@link accrueOnlineSeconds} from the heartbeat (inside
 * `touchPresence`'s transaction) and {@link availabilityBonusPort} from the
 * Monday job. Both run as the trusted server; the tables have no client write
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

/** Live seconds per tutor for one week, approved and unsuspended only. */
function weekSecondsQuery(weekStart: string) {
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
        gte(tutorOnlineTime.day, weekStart),
        lte(tutorOnlineTime.day, weekEndUtc(weekStart)),
        eq(tutorProfiles.approvalStatus, "approved"),
        eq(profiles.isSuspended, false),
      ),
    )
    .groupBy(tutorOnlineTime.tutorId);
}

export const availabilityBonusPort: AvailabilityBonusPort = {
  async listQualifiers(weekStart, minSeconds): Promise<Qualifier[]> {
    const rows = await weekSecondsQuery(weekStart).having(
      and(
        gte(sql`sum(${tutorOnlineTime.seconds})`, minSeconds),
        sql`not exists (
          select 1 from ${availabilityBonusAwards} a
          where a.tutor_id = ${tutorOnlineTime.tutorId} and a.week_start = ${weekStart}
        )`,
      ),
    );
    return rows.map((r) => ({ tutorId: r.tutorId, liveSeconds: r.liveSeconds }));
  },

  async claimAndCredit(award, credit) {
    return db.transaction(async (tx) => {
      // The award row first: its unique (tutor, week) is the claim. ON CONFLICT
      // DO NOTHING returns no row when another run already holds the week.
      const [row] = await tx
        .insert(availabilityBonusAwards)
        .values({
          tutorId: award.tutorId,
          weekStart: award.weekStart,
          liveSeconds: award.liveSeconds,
          credits: award.credits,
        })
        .onConflictDoNothing({
          target: [availabilityBonusAwards.tutorId, availabilityBonusAwards.weekStart],
        })
        .returning({ id: availabilityBonusAwards.id });
      if (!row) return null;

      const out = await credit(row.id, walletExecutor(tx));

      // Record which ledger row paid it. The ledger's unique (type, reference_id)
      // means there is exactly one.
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
          .update(availabilityBonusAwards)
          .set({ transactionId: ledgerRow.id })
          .where(eq(availabilityBonusAwards.id, row.id));
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

export interface TutorWeekProgress {
  weekStart: string;
  liveSeconds: number;
  /** Seconds per UTC day of the week, Monday first; 0 for days with no row. */
  days: { day: string; seconds: number }[];
}

export async function getTutorWeekProgress(
  tutorId: string,
  now: Date = new Date(),
): Promise<TutorWeekProgress> {
  const weekStart = weekStartUtc(now);
  const rows = await db
    .select({ day: tutorOnlineTime.day, seconds: tutorOnlineTime.seconds })
    .from(tutorOnlineTime)
    .where(
      and(
        eq(tutorOnlineTime.tutorId, tutorId),
        gte(tutorOnlineTime.day, weekStart),
        lte(tutorOnlineTime.day, weekEndUtc(weekStart)),
      ),
    );
  const byDay = new Map(rows.map((r) => [r.day, r.seconds]));
  const start = new Date(`${weekStart}T00:00:00Z`).getTime();
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = utcDayOf(new Date(start + i * 86_400_000));
    return { day, seconds: byDay.get(day) ?? 0 };
  });
  return {
    weekStart,
    liveSeconds: days.reduce((sum, d) => sum + d.seconds, 0),
    days,
  };
}

export interface TutorAward {
  id: string;
  weekStart: string;
  liveSeconds: number;
  credits: number;
  createdAt: Date;
}

export async function listTutorAwards(tutorId: string, limit = 12): Promise<TutorAward[]> {
  return db
    .select({
      id: availabilityBonusAwards.id,
      weekStart: availabilityBonusAwards.weekStart,
      liveSeconds: availabilityBonusAwards.liveSeconds,
      credits: availabilityBonusAwards.credits,
      createdAt: availabilityBonusAwards.createdAt,
    })
    .from(availabilityBonusAwards)
    .where(eq(availabilityBonusAwards.tutorId, tutorId))
    .orderBy(desc(availabilityBonusAwards.weekStart))
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

/** Every approved tutor with any live time in the week, most hours first. */
export async function listAdminWeekProgress(weekStart: string): Promise<AdminTutorProgress[]> {
  const sums = weekSecondsQuery(weekStart).as("sums");
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

export interface AdminAwardRow {
  id: string;
  weekStart: string;
  tutorId: string;
  fullName: string | null;
  slug: string;
  liveSeconds: number;
  credits: number;
  createdAt: Date;
}

/** Awards, newest week first, for the last `weeks` weeks of awards. */
export async function listAdminAwards(limit = 200): Promise<AdminAwardRow[]> {
  return db
    .select({
      id: availabilityBonusAwards.id,
      weekStart: availabilityBonusAwards.weekStart,
      tutorId: availabilityBonusAwards.tutorId,
      fullName: profiles.fullName,
      slug: tutorProfiles.slug,
      liveSeconds: availabilityBonusAwards.liveSeconds,
      credits: availabilityBonusAwards.credits,
      createdAt: availabilityBonusAwards.createdAt,
    })
    .from(availabilityBonusAwards)
    .innerJoin(profiles, eq(profiles.id, availabilityBonusAwards.tutorId))
    .innerJoin(tutorProfiles, eq(tutorProfiles.userId, availabilityBonusAwards.tutorId))
    .orderBy(desc(availabilityBonusAwards.weekStart), desc(availabilityBonusAwards.createdAt))
    .limit(limit);
}

/** This week's live seconds for one tutor, for the admin user page. */
export async function getTutorWeekSeconds(tutorId: string, now: Date = new Date()): Promise<number> {
  const weekStart = weekStartUtc(now);
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${tutorOnlineTime.seconds}), 0)::int` })
    .from(tutorOnlineTime)
    .where(
      and(
        eq(tutorOnlineTime.tutorId, tutorId),
        gte(tutorOnlineTime.day, weekStart),
        lte(tutorOnlineTime.day, weekEndUtc(weekStart)),
      ),
    );
  return row?.total ?? 0;
}
