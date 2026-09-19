import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bookings, profiles, tutorEarnings, tutorProfiles } from "@/db/schema";
import { liveTutors, publicProfiles } from "@/db/schema/views";
import { bucketByMonth, minutesToHours, type MonthBucket } from "@/lib/dashboard/months";

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

/**
 * Hours learned per month for a student (Part E): completed sessions of both
 * kinds, scheduled and instant, bucketed by when they started in the
 * student's timezone. `value` is hours to one decimal, `count` is sessions.
 * The oldest month is fetched with a day of slack either side of UTC so the
 * timezone bucketing, not the query, decides the edges.
 */
export async function getLearnerHoursByMonth(
  studentId: string,
  timeZone: string,
  months = 5,
  now = new Date(),
): Promise<MonthBucket[]> {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  const rows = await db
    .select({
      startedAt: bookings.startedAt,
      scheduledStartAt: bookings.scheduledStartAt,
      durationMinutes: bookings.durationMinutes,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.studentId, studentId),
        eq(bookings.status, "completed"),
        // An ISO string with a cast: a raw Date in a hand-written `sql` fragment
        // isn't serialised by the driver (the integration test caught it).
        sql`coalesce(${bookings.startedAt}, ${bookings.scheduledStartAt}) >= ${since.toISOString()}::timestamptz`,
      ),
    );
  const buckets = bucketByMonth(
    rows.map((r) => ({ at: r.startedAt ?? r.scheduledStartAt, value: r.durationMinutes ?? 0 })),
    timeZone,
    now,
    months,
  );
  return buckets.map((b) => ({ ...b, value: minutesToHours(b.value) }));
}

export interface StudentTutor {
  userId: string;
  slug: string;
  name: string;
  avatarUrl: string | null;
  /** In `live_tutors` for instant sessions AND taking requests: "Request" makes sense. */
  instantNow: boolean;
  /** In `live_tutors` at all (instant or broadcasting): the green dot. */
  liveNow: boolean;
  subject: string | null;
  /** Completed sessions with this student. */
  sessions: number;
}

/**
 * "Your tutors" (Part E; sidebar and dashboard right column): tutors this
 * student has booked (completed, confirmed or in progress) or saved, that are
 * still approved and not suspended. Live tutors first, then by sessions
 * together, then most recent. One query; conditions are inline, not shared.
 */
export async function getStudentTutors(studentId: string, limit = 4): Promise<StudentTutor[]> {
  const rows = await db.execute<{
    user_id: string;
    slug: string;
    display_name: string | null;
    avatar_url: string | null;
    accepts_instant: boolean;
    live_mode: string | null;
    live_user: string | null;
    subject: string | null;
    sessions: number;
  }>(sql`
    with mine as (
      select b.tutor_id,
             count(*) filter (where b.status = 'completed')::int as sessions,
             max(coalesce(b.started_at, b.scheduled_start_at)) as last_at
        from bookings b
       where b.student_id = ${studentId}
         and b.status in ('completed', 'confirmed', 'in_progress')
       group by b.tutor_id
      union all
      select f.tutor_id, 0, f.created_at
        from favourites f
       where f.student_id = ${studentId}
    )
    select tp.user_id, tp.slug, pp.display_name, pp.avatar_url, tp.accepts_instant,
           lt.live_mode, lt.user_id as live_user,
           (select s.name from tutor_subjects ts join subjects s on s.id = ts.subject_id
             where ts.tutor_id = tp.user_id order by s.sort_order limit 1) as subject,
           sum(m.sessions)::int as sessions
      from mine m
      join tutor_profiles tp on tp.user_id = m.tutor_id
      join public_profiles pp on pp.id = tp.user_id
      join profiles p on p.id = tp.user_id
      left join live_tutors lt on lt.user_id = tp.user_id
     where tp.approval_status = 'approved' and not p.is_suspended
     group by tp.user_id, tp.slug, pp.display_name, pp.avatar_url, tp.accepts_instant, lt.live_mode, lt.user_id
     order by (lt.user_id is not null) desc, sum(m.sessions) desc, max(m.last_at) desc nulls last
     limit ${limit}
  `);
  return Array.from(rows as Iterable<{
    user_id: string;
    slug: string;
    display_name: string | null;
    avatar_url: string | null;
    accepts_instant: boolean;
    live_mode: string | null;
    live_user: string | null;
    subject: string | null;
    sessions: number;
  }>).map((r) => ({
    userId: r.user_id,
    slug: r.slug,
    name: r.display_name ?? "Tutor",
    avatarUrl: r.avatar_url,
    liveNow: r.live_user != null,
    instantNow: r.live_user != null && r.live_mode !== "broadcast" && r.accepts_instant,
    subject: r.subject,
    sessions: Number(r.sessions ?? 0),
  }));
}

/**
 * Hours taught per month for a tutor (Part F): completed sessions of both
 * kinds by the month they started, in the tutor's timezone. `value` is hours
 * to one decimal, `count` is sessions. Same shape as the student's chart.
 */
export async function getTutorHoursByMonth(
  tutorId: string,
  timeZone: string,
  months = 5,
  now = new Date(),
): Promise<MonthBucket[]> {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  const rows = await db
    .select({
      startedAt: bookings.startedAt,
      scheduledStartAt: bookings.scheduledStartAt,
      durationMinutes: bookings.durationMinutes,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.tutorId, tutorId),
        eq(bookings.status, "completed"),
        sql`coalesce(${bookings.startedAt}, ${bookings.scheduledStartAt}) >= ${since.toISOString()}::timestamptz`,
      ),
    );
  const buckets = bucketByMonth(
    rows.map((r) => ({ at: r.startedAt ?? r.scheduledStartAt, value: r.durationMinutes ?? 0 })),
    timeZone,
    now,
    months,
  );
  return buckets.map((b) => ({ ...b, value: minutesToHours(b.value) }));
}

/**
 * Credits earned per month (Part F), from the earnings ledger: net credits of
 * every earning that wasn't reversed, by the month it was recorded (the
 * session's completion), in the tutor's timezone. Held, available and
 * withdrawn all count: they are the same money at different stages.
 */
export async function getTutorEarningsByMonth(
  tutorId: string,
  timeZone: string,
  months = 5,
  now = new Date(),
): Promise<MonthBucket[]> {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  const rows = await db
    .select({ createdAt: tutorEarnings.createdAt, net: tutorEarnings.netCredits })
    .from(tutorEarnings)
    .where(
      and(
        eq(tutorEarnings.tutorId, tutorId),
        sql`${tutorEarnings.status} <> 'reversed'`,
        sql`${tutorEarnings.createdAt} >= ${since.toISOString()}::timestamptz`,
      ),
    );
  return bucketByMonth(
    rows.map((r) => ({ at: r.createdAt, value: r.net })),
    timeZone,
    now,
    months,
  );
}

export interface ProfileCompleteness {
  hasPhoto: boolean;
  subjects: number;
  /** Active weekly availability rules. */
  availabilityRules: number;
  hasAbout: boolean;
}

/**
 * What a tutor's profile still needs (Part F; the dashboard's checklist): a
 * photo, subjects, weekly availability and an About. Facts, not a score.
 */
export async function getProfileCompleteness(tutorId: string): Promise<ProfileCompleteness> {
  const rows = await db.execute<{ has_photo: boolean; subjects: number; rules: number; has_about: boolean }>(sql`
    select
      (p.avatar_url is not null and p.avatar_url <> '') as has_photo,
      (select count(*) from tutor_subjects ts where ts.tutor_id = ${tutorId})::int as subjects,
      (select count(*) from availability_rules ar where ar.tutor_id = ${tutorId} and ar.is_active)::int as rules,
      (coalesce(length(trim(tp.about)), 0) > 0) as has_about
    from profiles p
    join tutor_profiles tp on tp.user_id = p.id
    where p.id = ${tutorId}
  `);
  const r = Array.from(rows as Iterable<{ has_photo: boolean; subjects: number; rules: number; has_about: boolean }>)[0];
  return {
    hasPhoto: !!r?.has_photo,
    subjects: Number(r?.subjects ?? 0),
    availabilityRules: Number(r?.rules ?? 0),
    hasAbout: !!r?.has_about,
  };
}

export interface TutorStudent {
  userId: string;
  name: string;
  avatarUrl: string | null;
  subject: string | null;
  /** Completed sessions with this tutor. */
  sessions: number;
  /** The existing conversation, if the student has written. Tutors can't start one. */
  conversationId: string | null;
}

/**
 * "Your students" / "Recent students" (Part F): students with a completed,
 * confirmed or in-progress booking with this tutor, most recent first, with the
 * subject of their latest booking and the conversation between them if one
 * exists. Only a student can start a conversation (Phase 9), so there is no
 * way to message someone who hasn't written first.
 */
export async function getTutorStudents(tutorId: string, limit = 4): Promise<TutorStudent[]> {
  const rows = await db.execute<{
    student_id: string;
    name: string | null;
    avatar_url: string | null;
    subject: string | null;
    sessions: number;
    conversation_id: string | null;
  }>(sql`
    with mine as (
      select b.student_id,
             count(*) filter (where b.status = 'completed')::int as sessions,
             max(coalesce(b.started_at, b.scheduled_start_at)) as last_at,
             (array_agg(b.subject_id order by coalesce(b.started_at, b.scheduled_start_at) desc nulls last))[1] as subject_id
        from bookings b
       where b.tutor_id = ${tutorId}
         and b.status in ('completed', 'confirmed', 'in_progress')
       group by b.student_id
    )
    select m.student_id,
           coalesce(p.display_name, p.full_name) as name,
           p.avatar_url,
           s.name as subject,
           m.sessions,
           (select c.id from conversations c
             where (c.participant_a = m.student_id and c.participant_b = ${tutorId})
                or (c.participant_b = m.student_id and c.participant_a = ${tutorId})
             limit 1) as conversation_id
      from mine m
      join profiles p on p.id = m.student_id
      left join subjects s on s.id = m.subject_id
     order by m.last_at desc nulls last
     limit ${limit}
  `);
  return Array.from(rows as Iterable<{
    student_id: string;
    name: string | null;
    avatar_url: string | null;
    subject: string | null;
    sessions: number;
    conversation_id: string | null;
  }>).map((r) => ({
    userId: r.student_id,
    name: r.name ?? "Student",
    avatarUrl: r.avatar_url,
    subject: r.subject,
    sessions: Number(r.sessions ?? 0),
    conversationId: r.conversation_id,
  }));
}
