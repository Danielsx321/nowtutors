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

// ── Price bands (USD labels; column is hourly_rate_credits) ──────────────────
// Bounds are [minUsd, maxUsd); the top band is open-ended.
export const PRICE_BANDS = {
  under_15: { label: "Under $15/hr", minUsd: 0, maxUsd: 15 },
  "15_25": { label: "$15–25", minUsd: 15, maxUsd: 25 },
  "25_50": { label: "$25–50", minUsd: 25, maxUsd: 50 },
  "50_100": { label: "$50–100", minUsd: 50, maxUsd: 100 },
  "100_plus": { label: "$100+", minUsd: 100, maxUsd: null },
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
 * Compose Drizzle WHERE conditions for the set filters only. `usdPerCredit` is
 * injected (read from platform_settings.credit_usd_rate via lib/settings.ts) so
 * the USD↔credits rate is never baked into filter logic.
 *
 * Not handled here (by design): `liveNow` (a live_tutors join in the query),
 * `sort` (ORDER BY), and `cursor` (keyset pagination).
 */
export function composeTutorFilters(
  query: TutorQuery,
  opts: { usdPerCredit: number },
): SQL[] {
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

  // Price band — USD bounds → credit bounds via the injected rate.
  if (query.priceBand) {
    const { minUsd, maxUsd } = PRICE_BANDS[query.priceBand];
    if (minUsd > 0) {
      conditions.push(
        gte(tutorProfiles.hourlyRateCredits, minUsd / opts.usdPerCredit),
      );
    }
    if (maxUsd !== null) {
      conditions.push(
        lt(tutorProfiles.hourlyRateCredits, maxUsd / opts.usdPerCredit),
      );
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
export function composeTutorWhere(
  query: TutorQuery,
  opts: { usdPerCredit: number },
): SQL | undefined {
  const conds = composeTutorFilters(query, opts);
  return conds.length ? and(...conds) : undefined;
}
