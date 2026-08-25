import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The DOM lane — a third, separate Vitest project (`pnpm test:dom`).
 *
 * **Why it exists.** Until this file, nothing in the repo had a DOM at all:
 * `vitest.config.ts` is `environment: "node"` and matches `tests/unit/**` only,
 * so no component had ever been rendered by a test. That is not a coverage gap
 * in the usual sense — it is a whole class of defect the suite was structurally
 * unable to see. The one this lane was added for
 * (`use-countdown.ts`, `elapsed` true for one render on a freshly-set deadline)
 * meant the tutor's incoming-request modal never painted at all, and a
 * 333-test green suite said nothing about it, because every one of those tests
 * asserts on a pure function's return value and the fault was in the ordering
 * of a render against an effect. See docs/DECISIONS.md, "The tutor's modal
 * never painted".
 *
 * **Why a separate config rather than `environment: "jsdom"` on the unit lane.**
 * The existing lane must keep running exactly as it does now: `jsdom` globally
 * would put every pure-money and pure-scheduling test in a fake browser it does
 * not need, changing what `globalThis` holds for 333 tests to serve a handful.
 * The two `include` globs are disjoint and so are the file extensions —
 * `tests/unit/**\/*.test.ts` cannot match `tests/dom/**\/*.test.tsx` — so
 * `pnpm test` can never pick these files up and `pnpm test:dom` can never pick
 * those up. Same separation, and the same reason, as
 * `vitest.integration.config.ts`.
 *
 * **In CI, unlike the DB lane.** This needs no Postgres, no `.env.test` and no
 * credentials — just `jsdom`, which installs like any other dev dependency. The
 * reason `vitest.integration.config.ts` stays out of `verify` does not apply.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/dom/**/*.test.tsx"],
    // No `globals: true` — the unit lane imports `describe`/`it`/`expect` from
    // `vitest` explicitly and there is no reason for this lane to read
    // differently. `setup.ts` is what unmounts between tests.
    setupFiles: ["./tests/dom/setup.ts"],
    // These tests are deterministic — they pin the clock with fake timers, so
    // the numbers they assert do not depend on how fast the machine is. What
    // DOES depend on the machine is standing up a jsdom environment and a React
    // renderer at all: one sweep on a loaded laptop took 65s to build the
    // environment against 3.8s idle, which is the kind of starvation that
    // exhausts a 5s per-test default while nothing is actually wrong. The
    // budget is a timeout on the machine, not on the assertion — the same
    // reason `vitest.integration.config.ts` raises its own.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
