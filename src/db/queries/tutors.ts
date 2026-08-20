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
  subjects: string[]; // up to 3 names
  liveStatus: LiveStatus;
  isFavourited: boolean;
}

export interface BrowseResult {
  cards: TutorCardData[];
  nextCursor: string | null;
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
  opts: { usdPerCredit: number; viewerId: string | null },
): Promise<BrowseResult> {
  const spec = sortSpec(query.sort);
  const cursor = decodeCursor(query.cursor);

  const conditions: SQL[] = [
    eq(tutorProfiles.approvalStatus, "approved"),
    eq(profiles.isSuspended, false),
    ...composeTutorFilters(query, { usdPerCredit: opts.usdPerCredit }),
  ];

  // live_now filter → require live_tutors membership (view-derived, §3.1).
  if (query.liveNow) {
    conditions.push(sql`${liveTutors.userId} is not null`);
  }

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

  const subjectsAgg = sql<
    string[]
  >`coalesce((select array_agg(s.name order by s.sort_order) from tutor_subjects ts join subjects s on s.id = ts.subject_id where ts.tutor_id = ${tutorProfiles.userId}), '{}')`;

  const primaryOrder = spec.dir === "desc" ? desc(spec.col) : asc(spec.col);

  const rows = await db
    .select({
      userId: tutorProfiles.userId,
      slug: tutorProfiles.slug,
      headline: tutorProfiles.headline,
      hourlyRateCredits: tutorProfiles.hourlyRateCredits,
      ratingAvg: tutorProfiles.ratingAvg,
      ratingCount: tutorProfiles.ratingCount,
      completedSessions: tutorProfiles.completedSessions,
      displayName: publicProfiles.displayName,
      avatarUrl: publicProfiles.avatarUrl,
      country: publicProfiles.country,
      liveMemberUserId: liveTutors.userId,
      liveMode: liveTutors.liveMode,
      isFavourited: sql<boolean>`${favourites.id} is not null`,
      sortKey: sql<number>`${spec.col}`,
      subjects: subjectsAgg,
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

  const cards: TutorCardData[] = page.map((r) => ({
    userId: r.userId,
    slug: r.slug,
    displayName: r.displayName,
    avatarUrl: r.avatarUrl,
    country: r.country,
    headline: r.headline,
    ratingAvg: Number(r.ratingAvg),
    ratingCount: r.ratingCount,
    hourlyRateCredits: r.hourlyRateCredits,
    subjects: (r.subjects ?? []).slice(0, 3),
    liveStatus: !r.liveMemberUserId
      ? "offline"
      : r.liveMode === "broadcast"
        ? "live"
        : "online",
    isFavourited: r.isFavourited,
  }));

  return {
    cards,
    nextCursor:
      hasMore && last ? encodeCursor(Number(last.sortKey), last.userId) : null,
  };
}
