import "server-only";
import { and, asc, desc, eq, gt, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { profiles, tutorProfiles } from "@/db/schema";
import { favourites } from "@/db/schema/favourites";
import { publicProfiles, liveTutors } from "@/db/schema/views";
import {
  composeTutorFilters,
  type TutorQuery,
  type TutorSort,
} from "@/lib/tutors/filters";

export const PAGE_SIZE = 24;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export type LiveStatus = "offline" | "online" | "live";

export interface TutorCardData {
  userId: string;
  slug: string;
  displayName: string | null;
  avatarUrl: string | null;
  country: string | null;
  headline: string | null;
  ratingAvg: number;
  ratingCount: number;
  hourlyRateCredits: number;
  /** Null when the tutor never filled it in; the card shows "New". */
  yearsExperience: number | null;
  completedSessions: number;
  /** Whether an "online" tutor takes instant requests (SPEC §7.4). */
  acceptsInstant: boolean;
  subjects: string[]; // up to 3 names
  liveStatus: LiveStatus;
  /**
   * The tutor's live broadcast, set only when `liveStatus` is `live` (Phase 9
   * Part 3). The card's LIVE badge links to `/live/[id]`; there is no video
   * preview on cards (DECISIONS, Phase 9 Part 3).
   */
  liveBroadcastId?: string | null;
  isFavourited: boolean;
}

/**
 * The tutor's live broadcast id, for a card or profile whose tutor is live in
 * broadcast mode. `tutor_profiles.user_id` must be in scope.
 */
export const liveBroadcastIdSql = sql<string | null>`(
  select b.id from broadcasts b
   where b.tutor_id = ${tutorProfiles.userId} and b.status = 'live'
   limit 1
)`;

export interface BrowseResult {
  cards: TutorCardData[];
  nextCursor: string | null;
}

/** The subjects aggregate every card select uses. `tutor_profiles.user_id` must be in scope. */
export const cardSubjectsSql = sql<
  string[]
>`coalesce((select array_agg(s.name order by s.sort_order) from tutor_subjects ts join subjects s on s.id = ts.subject_id where ts.tutor_id = ${tutorProfiles.userId}), '{}')`;

/** The columns every card select needs, so browse and favourites can't drift. */
export const cardColumns = {
  userId: tutorProfiles.userId,
  slug: tutorProfiles.slug,
  headline: tutorProfiles.headline,
  hourlyRateCredits: tutorProfiles.hourlyRateCredits,
  ratingAvg: tutorProfiles.ratingAvg,
  ratingCount: tutorProfiles.ratingCount,
  yearsExperience: tutorProfiles.yearsExperience,
  completedSessions: tutorProfiles.completedSessions,
  acceptsInstant: tutorProfiles.acceptsInstant,
  displayName: publicProfiles.displayName,
  avatarUrl: publicProfiles.avatarUrl,
  country: publicProfiles.country,
  liveMemberUserId: liveTutors.userId,
  liveMode: liveTutors.liveMode,
  liveBroadcastId: liveBroadcastIdSql,
  subjects: cardSubjectsSql,
};

type CardRow = {
  userId: string;
  slug: string;
  headline: string | null;
  hourlyRateCredits: number;
  ratingAvg: string | number;
  ratingCount: number;
  yearsExperience: number | null;
  completedSessions: number;
  acceptsInstant: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  country: string | null;
  liveMemberUserId: string | null;
  liveMode: string | null;
  liveBroadcastId: string | null;
  subjects: string[] | null;
};

/** Row to card. Live status derives from `live_tutors` membership, never `is_live` (SPEC §3.1). */
export function toTutorCard(r: CardRow, isFavourited: boolean): TutorCardData {
  return {
    userId: r.userId,
    slug: r.slug,
    displayName: r.displayName,
    avatarUrl: r.avatarUrl,
    country: r.country,
    headline: r.headline,
    ratingAvg: Number(r.ratingAvg),
    ratingCount: r.ratingCount,
    hourlyRateCredits: r.hourlyRateCredits,
    yearsExperience: r.yearsExperience,
    completedSessions: r.completedSessions,
    acceptsInstant: r.acceptsInstant,
    subjects: (r.subjects ?? []).slice(0, 3),
    liveStatus: !r.liveMemberUserId
      ? "offline"
      : r.liveMode === "broadcast"
        ? "live"
        : "online",
    liveBroadcastId: r.liveMemberUserId && r.liveMode === "broadcast" ? r.liveBroadcastId : null,
    isFavourited,
  };
}

// Keyset sort spec: a primary column + direction, with user_id asc as the stable
// tiebreaker. `relevance` uses completed_sessions until reviews exist.
function sortSpec(sort: TutorSort) {
  switch (sort) {
    case "price_asc":
      return { col: tutorProfiles.hourlyRateCredits, dir: "asc" as const };
    case "price_desc":
      return { col: tutorProfiles.hourlyRateCredits, dir: "desc" as const };
    case "most_sessions":
    case "relevance":
    default:
      return { col: tutorProfiles.completedSessions, dir: "desc" as const };
  }
}

function decodeCursor(cursor?: string): { k: number; id: string } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (typeof parsed.k === "number" && typeof parsed.id === "string") return parsed;
  } catch {
    /* malformed cursor → treat as no cursor */
  }
  return null;
}

function encodeCursor(k: number, id: string): string {
  return Buffer.from(JSON.stringify({ k, id })).toString("base64url");
}

/**
 * Browse tutors — approved, non-suspended, filtered, sorted, keyset-paginated.
 * Display fields come from public_profiles; live status derives from the
 * live_tutors view (never tutor_profiles.is_live — SPEC §3.1). `viewerId` is the
 * signed-in student, used only to compute each card's favourite state.
 */
export async function browseTutors(
  query: TutorQuery,
  opts: { viewerId: string | null },
): Promise<BrowseResult> {
  const spec = sortSpec(query.sort);
  const cursor = decodeCursor(query.cursor);

  const conditions: SQL[] = browseConditions(query);

  // Keyset continuation for the chosen sort.
  if (cursor) {
    const primaryPast =
      spec.dir === "desc" ? lt(spec.col, cursor.k) : gt(spec.col, cursor.k);
    conditions.push(
      or(
        primaryPast,
        and(eq(spec.col, cursor.k), gt(tutorProfiles.userId, cursor.id)),
      )!,
    );
  }

  const primaryOrder = spec.dir === "desc" ? desc(spec.col) : asc(spec.col);

  const rows = await db
    .select({
      ...cardColumns,
      isFavourited: sql<boolean>`${favourites.id} is not null`,
      sortKey: sql<number>`${spec.col}`,
    })
    .from(tutorProfiles)
    .innerJoin(publicProfiles, eq(publicProfiles.id, tutorProfiles.userId))
    .innerJoin(profiles, eq(profiles.id, tutorProfiles.userId))
    .leftJoin(liveTutors, eq(liveTutors.userId, tutorProfiles.userId))
    .leftJoin(
      favourites,
      and(
        eq(favourites.tutorId, tutorProfiles.userId),
        eq(favourites.studentId, opts.viewerId ?? NIL_UUID),
      ),
    )
    .where(and(...conditions))
    .orderBy(primaryOrder, asc(tutorProfiles.userId))
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const last = page[page.length - 1];

  const cards: TutorCardData[] = page.map((r) => toTutorCard(r, r.isFavourited));

  return {
    cards,
    nextCursor:
      hasMore && last ? encodeCursor(Number(last.sortKey), last.userId) : null,
  };
}

/** Approved, non-suspended, filtered. Shared by the page query and the count so they can't disagree. */
function browseConditions(query: TutorQuery): SQL[] {
  const conditions: SQL[] = [
    eq(tutorProfiles.approvalStatus, "approved"),
    eq(profiles.isSuspended, false),
    ...composeTutorFilters(query),
  ];
  // live_now filter → require live_tutors membership (view-derived, §3.1).
  if (query.liveNow) {
    conditions.push(sql`${liveTutors.userId} is not null`);
  }
  return conditions;
}

/**
 * How many tutors match the filters, across every page: the "128 tutors" line
 * on browse. Same joins and conditions as {@link browseTutors}, no cursor.
 */
export async function countBrowseTutors(query: TutorQuery): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tutorProfiles)
    .innerJoin(publicProfiles, eq(publicProfiles.id, tutorProfiles.userId))
    .innerJoin(profiles, eq(profiles.id, tutorProfiles.userId))
    .leftJoin(liveTutors, eq(liveTutors.userId, tutorProfiles.userId))
    .where(and(...browseConditions(query)));
  return row?.n ?? 0;
}

export interface LiveStrip {
  /** Every approved, non-suspended tutor in `live_tutors`, both modes. */
  count: number;
  /** Up to `limit` of them for the face strip, instant-available first. */
  faces: { userId: string; slug: string; displayName: string | null; avatarUrl: string | null }[];
}

/**
 * The home hero's "N tutors live now" and its faces (research report 01: the
 * one thing no competitor can show). Real numbers only; zero renders zero.
 */
export async function getLiveStrip(limit = 6): Promise<LiveStrip> {
  const base = and(
    eq(tutorProfiles.approvalStatus, "approved"),
    eq(profiles.isSuspended, false),
  );
  const [countRows, faces] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(liveTutors)
      .innerJoin(tutorProfiles, eq(tutorProfiles.userId, liveTutors.userId))
      .innerJoin(profiles, eq(profiles.id, tutorProfiles.userId))
      .where(base),
    db
      .select({
        userId: tutorProfiles.userId,
        slug: tutorProfiles.slug,
        displayName: publicProfiles.displayName,
        avatarUrl: publicProfiles.avatarUrl,
      })
      .from(liveTutors)
      .innerJoin(tutorProfiles, eq(tutorProfiles.userId, liveTutors.userId))
      .innerJoin(publicProfiles, eq(publicProfiles.id, tutorProfiles.userId))
      .innerJoin(profiles, eq(profiles.id, tutorProfiles.userId))
      .where(base)
      .orderBy(sql`(${liveTutors.liveMode} = 'broadcast')`, desc(tutorProfiles.completedSessions))
      .limit(limit),
  ]);
  return { count: countRows[0]?.n ?? 0, faces };
}

export interface SubjectCount {
  slug: string;
  name: string;
  tutors: number;
}

/** Active subjects that at least one bookable tutor teaches, with the count, for the subject tiles. */
export async function getSubjectTutorCounts(): Promise<SubjectCount[]> {
  const rows = await db.execute<{ slug: string; name: string; tutors: number }>(sql`
    select s.slug, s.name, count(distinct tp.user_id)::int as tutors
      from subjects s
      join tutor_subjects ts on ts.subject_id = s.id
      join tutor_profiles tp on tp.user_id = ts.tutor_id
      join profiles p on p.id = tp.user_id
     where s.is_active and tp.approval_status = 'approved' and not p.is_suspended
     group by s.slug, s.name, s.sort_order
     order by count(distinct tp.user_id) desc, s.sort_order
  `);
  return Array.from(rows as Iterable<{ slug: string; name: string; tutors: number }>);
}
