import { z } from "zod";
import { and, arrayOverlaps, gte, lt, sql, type SQL } from "drizzle-orm";
import { tutorProfiles } from "@/db/schema";

/**
 * Tutor browse filters — a standalone, DB-free composition layer (SPEC §3.3,
 * §15). `parseTutorSearchParams` normalizes the URL; `composeTutorFilters` turns
 * the normalized query into Drizzle WHERE conditions, emitting a condition ONLY
 * for filters the user actually set. No condition is ever built from a
 * null/absent value — that is the guarantee against Bubble's silently-dropped
 * constraints. Neither function opens a DB connection.
 */

// ── Price bands (credits per hour; column is hourly_rate_credits) ─────────────
// Credits are money, not time (SPEC §18 credits-are-money amendment), so the
// filter is in credits/hour directly — no USD conversion. Bounds are
// [minCredits, maxCredits); the top band is open-ended.
export const PRICE_BANDS = {
  under_50: { label: "Under 50 credits/hr", minCredits: 0, maxCredits: 50 },
  "50_100": { label: "50–100 credits/hr", minCredits: 50, maxCredits: 100 },
  "100_200": { label: "100–200 credits/hr", minCredits: 100, maxCredits: 200 },
  "200_400": { label: "200–400 credits/hr", minCredits: 200, maxCredits: 400 },
  "400_plus": { label: "400+ credits/hr", minCredits: 400, maxCredits: null },
} as const;

export type PriceBand = keyof typeof PRICE_BANDS;
export const PRICE_BAND_KEYS = Object.keys(PRICE_BANDS) as PriceBand[];

export const SORTS = [
  "relevance",
  "price_asc",
  "price_desc",
  "most_sessions",
] as const;
export type TutorSort = (typeof SORTS)[number];

export interface TutorQuery {
  subjects: string[]; // subject slugs
  languages: string[];
  priceBand?: PriceBand;
  minRating?: number; // supported for tests/future; NOT surfaced in v1 UI
  liveNow: boolean; // applied as a live_tutors join in the query, not a WHERE
  sort: TutorSort;
  cursor?: string;
}

const nonEmpty = (s: string) => s.trim().length > 0;
const uniq = (xs: string[]) => Array.from(new Set(xs));

const sortSchema = z.enum(SORTS).catch("relevance");
const bandSchema = z.enum(PRICE_BAND_KEYS as [PriceBand, ...PriceBand[]]);
const ratingSchema = z.coerce.number().min(0).max(5);

/**
 * Parse URL search params into a normalized query. Invalid/blank values are
 * dropped (never applied as a broken filter); unset filters are simply absent.
 * Repeatable params: `subject`, `lang`.
 */
export function parseTutorSearchParams(params: URLSearchParams): TutorQuery {
  const subjects = uniq(params.getAll("subject").filter(nonEmpty));
  const languages = uniq(params.getAll("lang").filter(nonEmpty));

  const bandRaw = params.get("price");
  const band = bandRaw ? bandSchema.safeParse(bandRaw) : undefined;

  const ratingRaw = params.get("minRating");
  const rating = ratingRaw ? ratingSchema.safeParse(ratingRaw) : undefined;

  return {
    subjects,
    languages,
    priceBand: band?.success ? band.data : undefined,
    minRating: rating?.success ? rating.data : undefined,
    liveNow: params.get("live") === "1",
    sort: sortSchema.parse(params.get("sort") ?? undefined),
    cursor: params.get("cursor") ?? undefined,
  };
}

/**
 * Compose Drizzle WHERE conditions for the set filters only. Fully pure — no
 * injected values, no DB read: price bands are in credits/hour and compare
 * directly against `hourly_rate_credits`.
 *
 * Not handled here (by design): `liveNow` (a live_tutors join in the query),
 * `sort` (ORDER BY), and `cursor` (keyset pagination).
 */
export function composeTutorFilters(query: TutorQuery): SQL[] {
  const conditions: SQL[] = [];

  // Subjects — tutor teaches ANY of the selected subject slugs.
  if (query.subjects.length > 0) {
    conditions.push(
      sql`exists (select 1 from tutor_subjects ts join subjects s on s.id = ts.subject_id where ts.tutor_id = ${tutorProfiles.userId} and s.slug in (${sql.join(
        query.subjects.map((slug) => sql`${slug}`),
        sql`, `,
      )}))`,
    );
  }

  // Languages — overlaps the selected set (Postgres array &&).
  if (query.languages.length > 0) {
    conditions.push(arrayOverlaps(tutorProfiles.languages, query.languages));
  }

  // Price band — credit bounds compared directly against hourly_rate_credits.
  if (query.priceBand) {
    const { minCredits, maxCredits } = PRICE_BANDS[query.priceBand];
    if (minCredits > 0) {
      conditions.push(gte(tutorProfiles.hourlyRateCredits, minCredits));
    }
    if (maxCredits !== null) {
      conditions.push(lt(tutorProfiles.hourlyRateCredits, maxCredits));
    }
  }

  // Minimum rating — supported here, but no control renders it in v1 (reviews
  // are deferred; rating_avg is 0 for everyone). Lights up when reviews ship.
  if (query.minRating != null) {
    conditions.push(gte(tutorProfiles.ratingAvg, String(query.minRating)));
  }

  return conditions;
}

/** Convenience: AND the composed conditions, or undefined when none are set. */
export function composeTutorWhere(query: TutorQuery): SQL | undefined {
  const conds = composeTutorFilters(query);
  return conds.length ? and(...conds) : undefined;
}
