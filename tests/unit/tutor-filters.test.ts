import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  parseTutorSearchParams,
  composeTutorFilters,
  composeTutorWhere,
  PRICE_BANDS,
  type TutorQuery,
} from "@/lib/tutors/filters";

const dialect = new PgDialect();
const RATE = 0.5; // usdPerCredit; $15 → 30 credits

function baseQuery(overrides: Partial<TutorQuery> = {}): TutorQuery {
  return {
    subjects: [],
    languages: [],
    priceBand: undefined,
    minRating: undefined,
    liveNow: false,
    sort: "relevance",
    cursor: undefined,
    ...overrides,
  };
}

function renderWhere(q: TutorQuery) {
  const where = composeTutorWhere(q, { usdPerCredit: RATE });
  return where ? dialect.sqlToQuery(where) : { sql: "", params: [] as unknown[] };
}

// ── parse ────────────────────────────────────────────────────────────────────
describe("parseTutorSearchParams", () => {
  it("returns empty/defaults for no params", () => {
    const q = parseTutorSearchParams(new URLSearchParams());
    expect(q).toEqual(baseQuery());
  });

  it("parses repeatable subject/lang, dedups, drops blanks", () => {
    const q = parseTutorSearchParams(
      new URLSearchParams("subject=algebra&subject=algebra&subject=&lang=English&lang=French"),
    );
    expect(q.subjects).toEqual(["algebra"]);
    expect(q.languages).toEqual(["English", "French"]);
  });

  it("keeps a valid price band and drops an invalid one", () => {
    expect(parseTutorSearchParams(new URLSearchParams("price=25_50")).priceBand).toBe("25_50");
    expect(parseTutorSearchParams(new URLSearchParams("price=cheap")).priceBand).toBeUndefined();
  });

  it("falls back to relevance for an unknown sort, and has no rating sort", () => {
    expect(parseTutorSearchParams(new URLSearchParams("sort=rating")).sort).toBe("relevance");
    expect(parseTutorSearchParams(new URLSearchParams("sort=price_asc")).sort).toBe("price_asc");
  });

  it("reads liveNow, minRating, cursor", () => {
    const q = parseTutorSearchParams(new URLSearchParams("live=1&minRating=4&cursor=abc"));
    expect(q.liveNow).toBe(true);
    expect(q.minRating).toBe(4);
    expect(q.cursor).toBe("abc");
  });

  it("drops an out-of-range minRating", () => {
    expect(parseTutorSearchParams(new URLSearchParams("minRating=9")).minRating).toBeUndefined();
  });
});

// ── compose: only-set-filters guarantee, exhaustive over the 4 composables ────
describe("composeTutorFilters — only set filters produce conditions", () => {
  it("emits nothing for an empty query", () => {
    expect(composeTutorFilters(baseQuery(), { usdPerCredit: RATE })).toHaveLength(0);
    expect(composeTutorWhere(baseQuery(), { usdPerCredit: RATE })).toBeUndefined();
  });

  const flags = [false, true];
  for (const subj of flags)
    for (const lang of flags)
      for (const price of flags)
        for (const rating of flags) {
          it(`combo subjects=${subj} lang=${lang} price=${price} rating=${rating}`, () => {
            const q = baseQuery({
              subjects: subj ? ["algebra"] : [],
              languages: lang ? ["English"] : [],
              priceBand: price ? "25_50" : undefined, // both bounds → 2 conds
              minRating: rating ? 4 : undefined,
            });
            const { sql } = renderWhere(q);
            // Each filter's SQL fingerprint appears iff it was set.
            expect(sql.includes("tutor_subjects")).toBe(subj);
            expect(/"tutor_profiles"\."languages"\s*&&/.test(sql)).toBe(lang);
            expect(sql.includes("hourly_rate_credits")).toBe(price);
            expect(sql.includes("rating_avg")).toBe(rating);
            // No condition ever built from an unset value → no stray "null".
            expect(sql.toLowerCase()).not.toContain("null");
          });
        }
});

// ── compose: price band → credit conversion via the injected rate ─────────────
describe("composeTutorFilters — price band conversion", () => {
  it("under_15 → only an upper bound (< 30 credits)", () => {
    const conds = composeTutorFilters(baseQuery({ priceBand: "under_15" }), { usdPerCredit: RATE });
    expect(conds).toHaveLength(1);
    const { sql, params } = renderWhere(baseQuery({ priceBand: "under_15" }));
    expect(sql).toContain("<");
    expect(params).toContain(PRICE_BANDS.under_15.maxUsd! / RATE); // 30
  });

  it("15_25 → lower 30 and upper 50", () => {
    const { params } = renderWhere(baseQuery({ priceBand: "15_25" }));
    expect(params).toContain(30);
    expect(params).toContain(50);
  });

  it("100_plus → only a lower bound (>= 200 credits)", () => {
    const conds = composeTutorFilters(baseQuery({ priceBand: "100_plus" }), { usdPerCredit: RATE });
    expect(conds).toHaveLength(1);
    const { params } = renderWhere(baseQuery({ priceBand: "100_plus" }));
    expect(params).toContain(200);
  });

  it("respects a different injected rate", () => {
    const { params } = renderWhere(baseQuery({ priceBand: "15_25" }));
    const other = composeTutorWhere(baseQuery({ priceBand: "15_25" }), { usdPerCredit: 1 });
    const otherParams = dialect.sqlToQuery(other!).params;
    expect(params).toContain(30); // at 0.5 → $15 = 30 credits
    expect(otherParams).toContain(15); // at 1.0 → $15 = 15 credits
  });
});

// ── compose: languages / subjects param wiring ────────────────────────────────
describe("composeTutorFilters — array + subquery params", () => {
  it("passes the selected languages as an overlap param (PG array literal)", () => {
    const { sql, params } = renderWhere(baseQuery({ languages: ["English", "French"] }));
    expect(/"tutor_profiles"\."languages"\s*&&/.test(sql)).toBe(true);
    expect(params).toContain('{"English","French"}');
  });

  it("passes each selected subject slug into the EXISTS subquery", () => {
    const { sql, params } = renderWhere(baseQuery({ subjects: ["algebra", "physics"] }));
    expect(sql).toContain("s.slug in");
    expect(params).toContain("algebra");
    expect(params).toContain("physics");
  });
});
