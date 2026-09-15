import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import {
  auditLog,
  profiles,
  tutorEarnings,
  tutorPayoutDetails,
  wallets,
  withdrawalRequests,
} from "@/db/schema";
import { pgErrorCode, walletExecutor } from "@/lib/credits/ledger";
import {
  OpenWithdrawalExistsError,
  type WithdrawalRow,
  type WithdrawalRunner,
  type WithdrawalStatus,
  type WithdrawalStore,
} from "@/lib/withdrawals/withdrawals";

/**
 * The Drizzle adapter for the withdrawal money path (SPEC §7.11; Phase 8
 * Part 2). The rules live in `lib/withdrawals/withdrawals.ts`; this file only
 * says how each step reaches Postgres.
 *
 * **Trusted server connection only.** `drizzle/0015` revoked every
 * `authenticated` write on `withdrawal_requests`, because a request row without
 * its `withdrawal_hold` debit is a payout of credits nobody set aside. The
 * callers are server actions that authorize first (§5 Layer 2).
 *
 * `updated_at` is maintained by the `set_updated_at` trigger (`drizzle/0003`).
 */

const UNIQUE_VIOLATION = "23505";

const rowColumns = {
  id: withdrawalRequests.id,
  tutorId: withdrawalRequests.tutorId,
  amountCredits: withdrawalRequests.amountCredits,
  amountUsd: withdrawalRequests.amountUsd,
  payoutDestination: withdrawalRequests.payoutDestination,
  status: withdrawalRequests.status,
  createdAt: withdrawalRequests.createdAt,
};

export function withdrawalStore(tx: DbTransaction): WithdrawalStore {
  return {
    ledger: walletExecutor(tx),

    async lockWalletBalance(tutorId) {
      // The serialization point for two requests from one tutor. The ledger
      // takes the same lock again inside debitWallet, which Postgres treats as
      // already held by this transaction.
      const [row] = await tx
        .select({ balance: wallets.creditBalance })
        .from(wallets)
        .where(eq(wallets.userId, tutorId))
        .for("update")
        .limit(1);
      return row?.balance ?? 0;
    },

    async getPayoutEmail(tutorId) {
      const [row] = await tx
        .select({ email: tutorPayoutDetails.paypalEmail })
        .from(tutorPayoutDetails)
        .where(eq(tutorPayoutDetails.tutorId, tutorId))
        .limit(1);
      return row?.email ?? null;
    },

    async hasOpenRequest(tutorId) {
      const [row] = await tx
        .select({ id: withdrawalRequests.id })
        .from(withdrawalRequests)
        .where(
          and(
            eq(withdrawalRequests.tutorId, tutorId),
            inArray(withdrawalRequests.status, ["requested", "approved"]),
          ),
        )
        .limit(1);
      return !!row;
    },

    async insertRequest(values) {
      try {
        const [row] = await tx
          .insert(withdrawalRequests)
          .values({ ...values, payoutMethod: "paypal", status: "requested" })
          .returning(rowColumns);
        return row as WithdrawalRow;
      } catch (err) {
        if (pgErrorCode(err) === UNIQUE_VIOLATION) {
          throw new OpenWithdrawalExistsError(values.tutorId);
        }
        throw err;
      }
    },

    async lockRequest(id) {
      const [row] = await tx
        .select(rowColumns)
        .from(withdrawalRequests)
        .where(eq(withdrawalRequests.id, id))
        .for("update")
        .limit(1);
      return (row as WithdrawalRow | undefined) ?? null;
    },

    async setStatus(id, patch) {
      await tx
        .update(withdrawalRequests)
        .set({
          status: patch.status,
          processedBy: patch.processedBy,
          processedAt: sql`now()`,
          ...(patch.adminNote !== undefined && { adminNote: patch.adminNote }),
          ...(patch.externalReference !== undefined && {
            externalReference: patch.externalReference,
          }),
        })
        .where(eq(withdrawalRequests.id, id));
    },

    async markEarningsWithdrawn(tutorId, requestedAt) {
      // The rows whose release credit is inside the balance the request took:
      // written before the request, for this tutor. A row released after the
      // request is still in the wallet and stays `available`.
      const rows = await tx.execute<{ id: string }>(sql`
        update tutor_earnings e
           set status = 'withdrawn'
         where e.tutor_id = ${tutorId}
           and e.status = 'available'
           and exists (
             select 1 from credit_transactions ct
              where ct.type = 'session_earning'
                and ct.user_id = ${tutorId}
                and ct.reference_id = e.booking_id
                and ct.created_at <= ${requestedAt.toISOString()}::timestamptz
           )
        returning e.id
      `);
      return Array.from(rows, (r) => r.id);
    },

    async insertAudit(entry) {
      await tx.insert(auditLog).values({
        actorId: entry.actorId,
        action: entry.action,
        targetType: "withdrawal_request",
        targetId: entry.targetId,
        payload: entry.payload,
      });
    },
  };
}

/** One `db.transaction` per call, bound to {@link withdrawalStore}. */
export const withdrawalRunner: WithdrawalRunner = (fn) =>
  db.transaction((tx) => fn(withdrawalStore(tx)));

// ── Reads for the pages ──────────────────────────────────────────────────────

export interface TutorWithdrawal {
  id: string;
  amountCredits: number;
  amountUsd: string;
  status: WithdrawalStatus;
  payoutDestination: string;
  adminNote: string | null;
  createdAt: Date;
  processedAt: Date | null;
}

export async function listTutorWithdrawals(
  tutorId: string,
): Promise<TutorWithdrawal[]> {
  return db
    .select({
      id: withdrawalRequests.id,
      amountCredits: withdrawalRequests.amountCredits,
      amountUsd: withdrawalRequests.amountUsd,
      status: withdrawalRequests.status,
      payoutDestination: withdrawalRequests.payoutDestination,
      adminNote: withdrawalRequests.adminNote,
      createdAt: withdrawalRequests.createdAt,
      processedAt: withdrawalRequests.processedAt,
    })
    .from(withdrawalRequests)
    .where(eq(withdrawalRequests.tutorId, tutorId))
    .orderBy(desc(withdrawalRequests.createdAt))
    .limit(50);
}

export interface AdminWithdrawal extends TutorWithdrawal {
  tutorId: string;
  tutorName: string | null;
  tutorEmail: string;
  externalReference: string | null;
}

const OPEN: WithdrawalStatus[] = ["requested", "approved"];

export async function listAdminWithdrawals(
  status: WithdrawalStatus,
): Promise<AdminWithdrawal[]> {
  const rows = await db
    .select({
      id: withdrawalRequests.id,
      tutorId: withdrawalRequests.tutorId,
      tutorName: sql<string | null>`coalesce(${profiles.displayName}, ${profiles.fullName})`,
      tutorEmail: profiles.email,
      amountCredits: withdrawalRequests.amountCredits,
      amountUsd: withdrawalRequests.amountUsd,
      status: withdrawalRequests.status,
      payoutDestination: withdrawalRequests.payoutDestination,
      adminNote: withdrawalRequests.adminNote,
      externalReference: withdrawalRequests.externalReference,
      createdAt: withdrawalRequests.createdAt,
      processedAt: withdrawalRequests.processedAt,
    })
    .from(withdrawalRequests)
    .innerJoin(profiles, eq(profiles.id, withdrawalRequests.tutorId))
    .where(eq(withdrawalRequests.status, status))
    // Open queues oldest first (work them in order); closed ones newest first.
    .orderBy(
      OPEN.includes(status)
        ? asc(withdrawalRequests.createdAt)
        : desc(withdrawalRequests.createdAt),
    )
    .limit(100);
  return rows;
}

export async function countWithdrawalsByStatus(): Promise<
  Record<WithdrawalStatus, number>
> {
  const rows = await db
    .select({
      status: withdrawalRequests.status,
      count: sql<number>`count(*)::int`,
    })
    .from(withdrawalRequests)
    .groupBy(withdrawalRequests.status);
  const counts: Record<WithdrawalStatus, number> = {
    requested: 0,
    approved: 0,
    paid: 0,
    rejected: 0,
    cancelled: 0,
  };
  for (const r of rows) counts[r.status] = r.count;
  return counts;
}

export async function getPayoutEmailFor(tutorId: string): Promise<string | null> {
  const [row] = await db
    .select({ email: tutorPayoutDetails.paypalEmail })
    .from(tutorPayoutDetails)
    .where(eq(tutorPayoutDetails.tutorId, tutorId))
    .limit(1);
  return row?.email ?? null;
}

export async function hasOpenWithdrawal(tutorId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: withdrawalRequests.id })
    .from(withdrawalRequests)
    .where(
      and(
        eq(withdrawalRequests.tutorId, tutorId),
        inArray(withdrawalRequests.status, OPEN),
      ),
    )
    .limit(1);
  return !!row;
}

export interface EarningsBreakdown {
  totals: Record<"held" | "available" | "withdrawn" | "reversed", number>;
  rows: {
    id: string;
    bookingId: string;
    grossCredits: number;
    netCredits: number;
    status: "held" | "available" | "withdrawn" | "reversed";
    availableAt: Date | null;
    createdAt: Date;
  }[];
}

export async function getTutorEarningsBreakdown(
  tutorId: string,
): Promise<EarningsBreakdown> {
  const [sums, rows] = await Promise.all([
    db
      .select({
        status: tutorEarnings.status,
        net: sql<number>`coalesce(sum(${tutorEarnings.netCredits}), 0)::int`,
      })
      .from(tutorEarnings)
      .where(eq(tutorEarnings.tutorId, tutorId))
      .groupBy(tutorEarnings.status),
    db
      .select({
        id: tutorEarnings.id,
        bookingId: tutorEarnings.bookingId,
        grossCredits: tutorEarnings.grossCredits,
        netCredits: tutorEarnings.netCredits,
        status: tutorEarnings.status,
        availableAt: tutorEarnings.availableAt,
        createdAt: tutorEarnings.createdAt,
      })
      .from(tutorEarnings)
      .where(eq(tutorEarnings.tutorId, tutorId))
      .orderBy(desc(tutorEarnings.createdAt))
      .limit(100),
  ]);
  const totals = { held: 0, available: 0, withdrawn: 0, reversed: 0 };
  for (const s of sums) totals[s.status] = s.net;
  return { totals, rows };
}
