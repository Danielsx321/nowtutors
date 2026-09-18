import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { profiles, tutorProfiles } from "@/db/schema";
import { liveTutors, publicProfiles } from "@/db/schema/views";

/**
 * Read-only aggregates for the home page and, from Part E on, the dashboards
 * (live-globe rebuild plan, "Dashboards show only data the app already has").
 * Nothing here writes, and nothing is padded: zero reads as zero.
 *
 * Every condition is built inside the function that uses it. A drizzle
 * `and(...)` carries its own parameter list, and sharing one instance between
 * queries that run concurrently interleaves their binding (the Part B bug,
 * DECISIONS 2026-09-17).
 */

/**
 * The countries of tutors live right now, for the globe's dots: approved,
 * non-suspended tutors in `live_tutors` (either mode), distinct ISO codes,
 * nulls dropped. Mapping codes to coordinates is `toGlobeMarkers`' job.
 */
export async function getLiveTutorCountries(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ country: publicProfiles.country })
    .from(liveTutors)
    .innerJoin(tutorProfiles, eq(tutorProfiles.userId, liveTutors.userId))
    .innerJoin(profiles, eq(profiles.id, tutorProfiles.userId))
    .innerJoin(publicProfiles, eq(publicProfiles.id, tutorProfiles.userId))
    .where(
      and(
        eq(tutorProfiles.approvalStatus, "approved"),
        eq(profiles.isSuspended, false),
        sql`${publicProfiles.country} is not null`,
      ),
    );
  return rows.map((r) => r.country).filter((c): c is string => !!c);
}

export interface HomeProof {
  /** Sum of `completed_sessions` across bookable tutors. */
  sessionsTaught: number;
  /** Approved, non-suspended tutors. */
  tutors: number;
  /** Active subjects that at least one bookable tutor teaches. */
  subjects: number;
}

/**
 * The home page's proof wall (Part C). Three real numbers in one round trip.
 * The "photo-checked" tile is not here on purpose: it can only be claimed once
 * approval requires a photo (Part G).
 */
export async function getHomeProof(): Promise<HomeProof> {
  const rows = await db.execute<{ sessions: number; tutors: number; subjects: number }>(sql`
    with bookable as (
      select tp.user_id, tp.completed_sessions
        from tutor_profiles tp
        join profiles p on p.id = tp.user_id
       where tp.approval_status = 'approved' and not p.is_suspended
    )
    select
      coalesce((select sum(completed_sessions) from bookable), 0)::int as sessions,
      (select count(*) from bookable)::int as tutors,
      (select count(distinct s.id)
         from subjects s
         join tutor_subjects ts on ts.subject_id = s.id
         join bookable b on b.user_id = ts.tutor_id
        where s.is_active)::int as subjects
  `);
  const row = Array.from(rows as Iterable<{ sessions: number; tutors: number; subjects: number }>)[0];
  return {
    sessionsTaught: Number(row?.sessions ?? 0),
    tutors: Number(row?.tutors ?? 0),
    subjects: Number(row?.subjects ?? 0),
  };
}
