import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { defineConfig } from "vitest/config";
import { assertTestProjectRef } from "./src/db/load-env";

/**
 * The DB-backed lane — a second, separate Vitest project (`pnpm test:db:test`).
 *
 * `vitest.config.ts` is the unit lane and runs **without a database by design**:
 * every module it exercises is pure, which is why the accept transaction, the
 * ledger and settlement are all storage-agnostic. That design has one blind
 * spot, and it is not a small one — a rule expressed *in SQL* cannot be
 * unit-tested at all. `stampSessionJoin` (`db/queries/sessions.ts`) is exactly
 * that: its correctness is a property of how Postgres re-evaluates a blocked
 * `UPDATE` under READ COMMITTED, and no fake, mock or in-memory store can
 * reproduce it. Asserting it needs a real server and two real connections.
 *
 * So this lane exists rather than a new file in `tests/unit/`, and the two
 * `include` globs are disjoint on purpose: `pnpm test` matches
 * `tests/unit/**` only and can never pick these files up.
 *
 * **Deliberately NOT in the CI `verify` job.** The runner has no Postgres and
 * no `.env.test` (it is gitignored and holds live credentials), so adding this
 * step would fail the required check on every PR — for missing infrastructure,
 * not for a broken assertion, which is the worst kind of red. It is a local /
 * pre-Part-3B gate, run by hand against the disposable test project. See
 * docs/DECISIONS.md, "Phase 6 Part 3A — `started_at` concurrency coverage".
 */

const TEST_ENV_FILE = ".env.test";

// Fail before Vitest collects a single file if `.env.test` is absent or does not
// actually point at the disposable test project — the same guard
// `drizzle.config.test.ts` and `playwright.config.ts` run at config load, for
// the same reason. This lane opens transactions and writes rows; the shared
// project (`mipnoxlhurdbaahmvhhx`) also serves production, so the check is worth
// a startup cost. `tests/integration/helpers/test-db.ts` runs it a second time
// against the string it is about to connect with, because this one only proves
// what is on disk.
if (!existsSync(TEST_ENV_FILE)) {
  throw new Error(
    `${TEST_ENV_FILE} not found. This lane runs against the disposable test ` +
      `Supabase project only — see docs/RUNBOOK.md, "Test Supabase project", ` +
      `and .env.test.example for the key list. It is never run in CI.`,
  );
}
const testEnv = parse(readFileSync(TEST_ENV_FILE, "utf8"));
assertTestProjectRef(
  `${testEnv.DATABASE_URL ?? ""} ${testEnv.DIRECT_URL ?? ""} ${testEnv.NEXT_PUBLIC_SUPABASE_URL ?? ""}`,
);

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` is not an installed package — Next's bundler aliases it,
      // and nothing else does. `db/queries/sessions.ts` imports it, so without
      // this the module fails to resolve here. Points at the same empty shim
      // Next substitutes in a server build, so the import is a no-op rather
      // than the throwing client-guard build.
      "server-only": fileURLToPath(
        new URL(
          "./node_modules/next/dist/compiled/server-only/empty.js",
          import.meta.url,
        ),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // One file at a time, and no concurrent tests inside it. Every test in this
    // lane owns a fixture booking and asserts on row-level lock behaviour;
    // parallel workers racing on the same rows would produce failures that say
    // nothing about the code under test.
    fileParallelism: false,
    // Supabase is remote (eu-west-3) and one test deliberately holds a
    // transaction open while another blocks on it. The default 5s is a timeout
    // on the network, not on the assertion.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
