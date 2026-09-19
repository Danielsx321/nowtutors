import "server-only";
import { and, count, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { auditLog, bookings, profiles, tutorEarnings, tutorProfiles, wallets, withdrawalRequests } from "@/db/schema";
import {
  creditWallet,
  DuplicateLedgerReferenceError,
  InsufficientCreditsError,
  walletExecutor,
} from "@/lib/credits/ledger";
import {
  ADJUSTMENT_DESCRIPTION,
  canAdjustWallet,
  promotionBlockers,
  type PromotionBlocker,
  suspensionConfirmed,
  type PromotionFacts,
  type Role,
  type UserFilter,
} from "@/lib/admin/users";

/**
 * `/admin/users` reads and writes (SPEC §5, §6, §7.10; Phase 8 Part 5).
 *
 * The `apply*` functions take the caller's transaction and write their own
 * `audit_log` row in it, so a change and its audit entry commit together. They
 * run on the trusted server connection: `profiles_guard` accepts it since
 * `drizzle/0016`, and authorization is the action's `requireRole('admin')`.
 * Credits move only through `lib/credits/ledger.ts`.
 */

export const USERS_PAGE_SIZE = 25;

export interface AdminUserRow {
  id: string;
  email: string;
  displayName: string | null;
  fullName: string | null;
  role: Role | null;
  isSuspended: boolean;
  createdAt: Date;
  balance: number;
  approvalStatus: "pending" | "approved" | "rejected" | null;
}

function searchWhere(q: string | null, filter: UserFilter | null): SQL | undefined {
  const conditions: SQL[] = [];
  if (q) {
    // position(), not LIKE: a % or _ in the search box is a literal character.
    conditions.push(sql`(
      position(${q} in lower(${profiles.email})) > 0
      or position(${q} in lower(coalesce(${profiles.displayName}, ''))) > 0
      or position(${q} in lower(coalesce(${profiles.fullName}, ''))) > 0
    )`);
  }
  if (filter === "suspended") conditions.push(eq(profiles.isSuspended, true));
  else if (filter === "unset") conditions.push(isNull(profiles.role));
  else if (filter) conditions.push(eq(profiles.role, filter));
  return conditions.length ? and(...conditions) : undefined;
}

export async function searchAdminUsers(f: {
  q: string | null;
  filter: UserFilter | null;
  page?: number;
}): Promise<{ users: AdminUserRow[]; total: number; page: number; pageCount: number }> {
  const page = Math.max(1, Math.floor(f.page ?? 1));
  const where = searchWhere(f.q, f.filter);

  const [[totalRow], users] = await Promise.all([
    db.select({ n: count() }).from(profiles).where(where),
    db
      .select({
        id: profiles.id,
        email: profiles.email,
        displayName: profiles.displayName,
        fullName: profiles.fullName,
        role: profiles.role,
        isSuspended: profiles.isSuspended,
        createdAt: profiles.createdAt,
        balance: sql<number>`coalesce(${wallets.creditBalance}, 0)::int`,
        approvalStatus: tutorProfiles.approvalStatus,
      })
      .from(profiles)
      .leftJoin(wallets, eq(wallets.userId, profiles.id))
      .leftJoin(tutorProfiles, eq(tutorProfiles.userId, profiles.id))
      .where(where)
      .orderBy(desc(profiles.createdAt), desc(profiles.id))
      .limit(USERS_PAGE_SIZE)
      .offset((page - 1) * USERS_PAGE_SIZE),
  ]);

  const total = Number(totalRow?.n ?? 0);
  return {
    users: users.map((u) => ({ ...u, balance: Number(u.balance) })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / USERS_PAGE_SIZE)),
  };
}

export interface AdminUserDetail {
  id: string;
  email: string;
  displayName: string | null;
  fullName: string | null;
  role: Role | null;
  isSuspended: boolean;
  country: string | null;
  timezone: string | null;
  createdAt: Date;
  onboardingCompletedAt: Date | null;
  lastSeenAt: Date | null;
  walletBalance: number;
  tutor: { slug: string; approvalStatus: "pending" | "approved" | "rejected"; isLive: boolean } | null;
  /** Bookings where the user is student or tutor, counted by status. */
  bookingsByStatus: Record<string, number>;
  earnings: { held: number; available: number; withdrawn: number; reversed: number };
  openWithdrawal: { amountCredits: number; status: string } | null;
}

export async function getAdminUserDetail(userId: string): Promise<AdminUserDetail | null> {
  const [[p], [tutor], statusRows, earningRows, [open]] = await Promise.all([
    db
      .select({
        id: profiles.id,
        email: profiles.email,
        displayName: profiles.displayName,
        fullName: profiles.fullName,
        role: profiles.role,
        isSuspended: profiles.isSuspended,
        country: profiles.country,
        timezone: profiles.timezone,
        createdAt: profiles.createdAt,
        onboardingCompletedAt: profiles.onboardingCompletedAt,
        lastSeenAt: profiles.lastSeenAt,
        walletBalance: sql<number>`coalesce(${wallets.creditBalance}, 0)::int`,
      })
      .from(profiles)
      .leftJoin(wallets, eq(wallets.userId, profiles.id))
      .where(eq(profiles.id, userId))
      .limit(1),
    db
      .select({
        slug: tutorProfiles.slug,
        approvalStatus: tutorProfiles.approvalStatus,
        isLive: tutorProfiles.isLive,
      })
      .from(tutorProfiles)
      .where(eq(tutorProfiles.userId, userId))
      .limit(1),
    db
      .select({ status: bookings.status, n: count() })
      .from(bookings)
      .where(sql`${bookings.studentId} = ${userId} or ${bookings.tutorId} = ${userId}`)
      .groupBy(bookings.status),
    db
      .select({
        status: tutorEarnings.status,
        credits: sql<number>`coalesce(sum(${tutorEarnings.netCredits}), 0)::int`,
      })
      .from(tutorEarnings)
      .where(eq(tutorEarnings.tutorId, userId))
      .groupBy(tutorEarnings.status),
    db
      .select({ amountCredits: withdrawalRequests.amountCredits, status: withdrawalRequests.status })
      .from(withdrawalRequests)
      .where(
        and(
          eq(withdrawalRequests.tutorId, userId),
          sql`${withdrawalRequests.status} in ('requested', 'approved')`,
        ),
      )
      .limit(1),
  ]);
  if (!p) return null;

  const earnings = { held: 0, available: 0, withdrawn: 0, reversed: 0 };
  for (const r of earningRows) earnings[r.status] = Number(r.credits);

  return {
    ...p,
    walletBalance: Number(p.walletBalance),
    tutor: tutor ?? null,
    bookingsByStatus: Object.fromEntries(statusRows.map((r) => [r.status, Number(r.n)])),
    earnings,
    openWithdrawal: open ?? null,
  };
}

type Tx = DbTransaction;

/** Lock the profile row for an admin change. */
async function lockProfile(tx: Tx, userId: string) {
  const [p] = await tx
    .select({
      role: profiles.role,
      isSuspended: profiles.isSuspended,
      email: profiles.email,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .for("update")
    .limit(1);
  return p ?? null;
}

export type SuspensionResult =
  | { ok: true; changed: boolean; wentOffline: boolean }
  | { ok: false; reason: "not_found" | "confirm" };

/**
 * Set `profiles.is_suspended`. A no-op writes nothing. Suspending a tutor who is
 * live also takes them offline, so they drop out of instant requests now rather
 * than when the presence sweep notices.
 */
export async function applySuspension(
  tx: Tx,
  p: { userId: string; suspended: boolean; actorId: string; confirmEmail?: string },
): Promise<SuspensionResult> {
  const before = await lockProfile(tx, p.userId);
  if (!before) return { ok: false, reason: "not_found" };
  // Suspending needs the account's email typed (Part I). Checked against the
  // locked row, so it's the email as it is now. Unsuspending needs nothing.
  if (p.suspended && !before.isSuspended && !suspensionConfirmed(p.confirmEmail, before.email)) {
    return { ok: false, reason: "confirm" };
  }
  if (before.isSuspended === p.suspended) return { ok: true, changed: false, wentOffline: false };

  await tx.update(profiles).set({ isSuspended: p.suspended }).where(eq(profiles.id, p.userId));

  let wentOffline = false;
  if (p.suspended) {
    const offline = await tx
      .update(tutorProfiles)
      .set({ isLive: false, liveMode: null })
      .where(and(eq(tutorProfiles.userId, p.userId), eq(tutorProfiles.isLive, true)))
      .returning({ id: tutorProfiles.id });
    wentOffline = offline.length > 0;
  }

  await tx.insert(auditLog).values({
    actorId: p.actorId,
    action: p.suspended ? "user.suspend" : "user.unsuspend",
    targetType: "profile",
    targetId: p.userId,
    payload: { email: before.email, from: before.isSuspended, to: p.suspended, went_offline: wentOffline },
  });
  return { ok: true, changed: true, wentOffline };
}

/**
 * Promotion facts, read under locks on the profile and the wallet. Every paid
 * booking debits through the wallet lock, so a checkout can't slip in between
 * this read and the role change.
 */
export async function readPromotionFacts(tx: Tx, userId: string): Promise<PromotionFacts | null> {
  const p = await lockProfile(tx, userId);
  if (!p) return null;
  await tx.select({ id: wallets.id }).from(wallets).where(eq(wallets.userId, userId)).for("update");

  const [c] = Array.from(
    await tx.execute<{
      balance: number;
      open_bookings: number;
      open_withdrawals: number;
      unpaid_earnings: number;
    }>(sql`
      select
        coalesce((select credit_balance from wallets where user_id = ${userId}), 0)::int as balance,
        (select count(*) from bookings
          where (student_id = ${userId} or tutor_id = ${userId})
            and status in ('pending_payment', 'confirmed', 'in_progress'))::int as open_bookings,
        (select count(*) from withdrawal_requests
          where tutor_id = ${userId} and status in ('requested', 'approved'))::int as open_withdrawals,
        (select count(*) from tutor_earnings
          where tutor_id = ${userId} and status in ('held', 'available'))::int as unpaid_earnings
    `),
  );

  return {
    role: p.role,
    isSuspended: p.isSuspended,
    email: p.email,
    walletBalance: Number(c.balance),
    openBookings: Number(c.open_bookings),
    openWithdrawals: Number(c.open_withdrawals),
    unpaidEarnings: Number(c.unpaid_earnings),
  };
}

export type PromotionResult = { ok: true } | { ok: false; blockers: PromotionBlocker[] };

export async function applyPromotion(
  tx: Tx,
  p: { userId: string; confirmEmail: string; actorId: string },
): Promise<PromotionResult> {
  const facts = await readPromotionFacts(tx, p.userId);
  const blockers = promotionBlockers(facts, p.confirmEmail);
  if (blockers.length || !facts) return { ok: false, blockers };

  await tx.update(profiles).set({ role: "admin" }).where(eq(profiles.id, p.userId));
  await tx.insert(auditLog).values({
    actorId: p.actorId,
    action: "user.promote_admin",
    targetType: "profile",
    targetId: p.userId,
    payload: { email: facts.email, from: facts.role, to: "admin" },
  });
  return { ok: true };
}

export type AdjustmentResult =
  | { ok: true; duplicate: false; balanceAfter: number }
  | { ok: true; duplicate: true }
  | { ok: false; reason: "not_found" | "role" }
  | { ok: false; reason: "insufficient"; available: number };

/**
 * An audited `admin_adjustment` through the ledger. The request key is the
 * ledger `reference_id`, so the same form submitted twice lands once.
 *
 * The ledger call runs in a savepoint (`tx.transaction`): a duplicate key is a
 * unique violation, which would otherwise abort the whole transaction.
 */
export async function applyCreditAdjustment(
  tx: Tx,
  p: { userId: string; delta: number; note: string; requestKey: string; actorId: string },
): Promise<AdjustmentResult> {
  const [target] = await tx
    .select({ role: profiles.role, email: profiles.email })
    .from(profiles)
    .where(eq(profiles.id, p.userId))
    .limit(1);
  if (!target) return { ok: false, reason: "not_found" };
  if (!canAdjustWallet(target.role)) return { ok: false, reason: "role" };

  let balanceAfter: number;
  try {
    ({ balanceAfter } = await tx.transaction((sp) =>
      creditWallet(walletExecutor(sp), {
        userId: p.userId,
        delta: p.delta,
        type: "admin_adjustment",
        referenceType: "admin_adjustment",
        referenceId: p.requestKey,
        description: ADJUSTMENT_DESCRIPTION,
        createdBy: p.actorId,
      }),
    ));
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return { ok: false, reason: "insufficient", available: err.available };
    }
    if (err instanceof DuplicateLedgerReferenceError) return { ok: true, duplicate: true };
    throw err;
  }

  await tx.insert(auditLog).values({
    actorId: p.actorId,
    action: "wallet.adjust",
    targetType: "profile",
    targetId: p.userId,
    payload: {
      email: target.email,
      delta: p.delta,
      balance_after: balanceAfter,
      note: p.note,
      request_key: p.requestKey,
    },
  });
  return { ok: true, duplicate: false, balanceAfter };
}
