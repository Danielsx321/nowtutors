import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * The `/admin` overview counts (SPEC §6; §14 rules out analytics dashboards, so
 * this is counts and sums only; Phase 8 Part 4).
 *
 * **"Today" and "this month" are the admin's calendar, not UTC.** Bounds are
 * computed in Postgres from the admin's IANA timezone, so an admin in Lagos and
 * one in Sydney each see their own day. The bounds are half-open
 * (`>= start and < end`).
 *
 * One statement, so every number describes the same snapshot.
 */

export interface AdminOverview {
  students: number;
  tutors: number;
  admins: number;
  /** Signed up, never picked a role. */
  noRole: number;
  suspended: number;
  /** Real bookings (not unpaid or expired) starting today. */
  sessionsToday: number;
  capturedTodayUsd: string;
  capturedTodayCount: number;
  capturedMonthUsd: string;
  pendingTutorApprovals: number;
  tutorsNeedingReReview: number;
  withdrawalsRequested: number;
  withdrawalsApproved: number;
}

/** A timezone Postgres and Intl both accept, or UTC. */
export function safeTimeZone(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

export async function getAdminOverview(
  timeZone: string,
  now: Date = new Date(),
): Promise<AdminOverview> {
  const tz = safeTimeZone(timeZone);
  const at = now.toISOString();

  const [row] = Array.from(
    await db.execute<{
      students: number;
      tutors: number;
      admins: number;
      no_role: number;
      suspended: number;
      sessions_today: number;
      captured_today_usd: string;
      captured_today_count: number;
      captured_month_usd: string;
      pending_tutor_approvals: number;
      tutors_needing_re_review: number;
      withdrawals_requested: number;
      withdrawals_approved: number;
    }>(sql`
      with b as (
        select
          (date_trunc('day', ${at}::timestamptz at time zone ${tz}::text) at time zone ${tz}::text) as day_start,
          ((date_trunc('day', ${at}::timestamptz at time zone ${tz}::text) + interval '1 day') at time zone ${tz}::text) as day_end,
          (date_trunc('month', ${at}::timestamptz at time zone ${tz}::text) at time zone ${tz}::text) as month_start,
          ((date_trunc('month', ${at}::timestamptz at time zone ${tz}::text) + interval '1 month') at time zone ${tz}::text) as month_end
      )
      select
        (select count(*) from profiles where role = 'student')::int as students,
        (select count(*) from profiles where role = 'tutor')::int as tutors,
        (select count(*) from profiles where role = 'admin')::int as admins,
        (select count(*) from profiles where role is null)::int as no_role,
        (select count(*) from profiles where is_suspended)::int as suspended,
        (select count(*) from bookings k, b
          where k.status not in ('pending_payment', 'expired')
            and coalesce(k.scheduled_start_at, k.started_at, k.created_at) >= b.day_start
            and coalesce(k.scheduled_start_at, k.started_at, k.created_at) < b.day_end)::int as sessions_today,
        (select coalesce(sum(p.amount_usd), 0)::text from payments p, b
          where p.status = 'captured' and p.captured_at >= b.day_start and p.captured_at < b.day_end) as captured_today_usd,
        (select count(*) from payments p, b
          where p.status = 'captured' and p.captured_at >= b.day_start and p.captured_at < b.day_end)::int as captured_today_count,
        (select coalesce(sum(p.amount_usd), 0)::text from payments p, b
          where p.status = 'captured' and p.captured_at >= b.month_start and p.captured_at < b.month_end) as captured_month_usd,
        (select count(*) from tutor_profiles where approval_status = 'pending')::int as pending_tutor_approvals,
        (select count(*) from tutor_profiles
          where approval_status = 'approved'
            and profile_changed_at is not null
            and (profile_reviewed_at is null or profile_reviewed_at < profile_changed_at))::int as tutors_needing_re_review,
        (select count(*) from withdrawal_requests where status = 'requested')::int as withdrawals_requested,
        (select count(*) from withdrawal_requests where status = 'approved')::int as withdrawals_approved
    `),
  );

  return {
    students: Number(row.students),
    tutors: Number(row.tutors),
    admins: Number(row.admins),
    noRole: Number(row.no_role),
    suspended: Number(row.suspended),
    sessionsToday: Number(row.sessions_today),
    capturedTodayUsd: String(row.captured_today_usd),
    capturedTodayCount: Number(row.captured_today_count),
    capturedMonthUsd: String(row.captured_month_usd),
    pendingTutorApprovals: Number(row.pending_tutor_approvals),
    tutorsNeedingReReview: Number(row.tutors_needing_re_review),
    withdrawalsRequested: Number(row.withdrawals_requested),
    withdrawalsApproved: Number(row.withdrawals_approved),
  };
}
