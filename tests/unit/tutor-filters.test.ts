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
  const where = composeTutorWhere(q);
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
    expect(parseTutorSearchParams(new URLSearchParams("price=100_200")).priceBand).toBe("100_200");
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
    expect(composeTutorFilters(baseQuery())).toHaveLength(0);
    expect(composeTutorWhere(baseQuery())).toBeUndefined();
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
              priceBand: price ? "100_200" : undefined, // both bounds → 2 conds
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

// ── compose: price band → credit bounds, compared directly (no conversion) ────
describe("composeTutorFilters — price band credit bounds", () => {
  it("under_50 → only an upper bound (< 50 credits)", () => {
    const conds = composeTutorFilters(baseQuery({ priceBand: "under_50" }));
    expect(conds).toHaveLength(1);
    const { sql, params } = renderWhere(baseQuery({ priceBand: "under_50" }));
    expect(sql).toContain("<");
    expect(params).toContain(PRICE_BANDS.under_50.maxCredits!); // 50
  });

  it("50_100 → lower 50 and upper 100", () => {
    const { params } = renderWhere(baseQuery({ priceBand: "50_100" }));
    expect(params).toContain(50);
    expect(params).toContain(100);
  });

  it("400_plus → only a lower bound (>= 400 credits)", () => {
    const conds = composeTutorFilters(baseQuery({ priceBand: "400_plus" }));
    expect(conds).toHaveLength(1);
    const { params } = renderWhere(baseQuery({ priceBand: "400_plus" }));
    expect(params).toContain(400);
  });

  it("bounds are the credit values verbatim — no USD conversion", () => {
    const { params } = renderWhere(baseQuery({ priceBand: "200_400" }));
    expect(params).toContain(200);
    expect(params).toContain(400);
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
