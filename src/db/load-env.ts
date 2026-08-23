import { config } from "dotenv";

// Single mechanism for choosing which env file a db script targets: an
// explicit `--env=dev|test` CLI arg, always passed by the package.json script
// itself (never left to a default), so `pnpm db:reset` and `pnpm db:reset:test`
// can never be confused for one another. See docs/RUNBOOK.md.
export type DbEnv = "dev" | "test";

export function loadDbEnv(): DbEnv {
  const arg = process.argv.find((a) => a.startsWith("--env="));
  if (arg !== "--env=dev" && arg !== "--env=test") {
    throw new Error(
      `Missing or invalid --env flag (got ${JSON.stringify(arg)}). ` +
        `This script must be run via its pnpm script (db:*:test or db:*), ` +
        `never invoked directly without --env=dev|test.`,
    );
  }
  const dbEnv: DbEnv = arg === "--env=test" ? "test" : "dev";
  config({ path: dbEnv === "test" ? ".env.test" : ".env.local" });
  return dbEnv;
}

// The nowtutors-test Supabase project ref. Hardcoded rather than read from an
// env var: a guard that can be silently disabled by an unset variable is not
// a guard. See docs/RUNBOOK.md.
export const TEST_PROJECT_REF = "uietkphpfqaicbndunwt";

// Hard guard for test-targeted scripts: aborts unless the resolved connection
// string actually points at the disposable test project. Prevents a
// misconfigured .env.test (e.g. still pointing at dev) from silently running
// destructive commands against the wrong database.
export function assertTestProjectRef(connectionUrl: string) {
  if (!connectionUrl.includes(TEST_PROJECT_REF)) {
    throw new Error(
      `Refusing to run: the resolved connection string does not contain the ` +
        `test project ref "${TEST_PROJECT_REF}". This guard exists to stop a ` +
        `test-targeted script from accidentally running against dev/prod.`,
    );
  }
}
