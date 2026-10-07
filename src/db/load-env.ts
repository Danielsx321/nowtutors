import { config } from "dotenv";

// Single mechanism for choosing which env file a db script targets: an
// explicit `--env=dev|test` CLI arg, always passed by the package.json script
// itself (never left to a default), so `pnpm db:reset` and `pnpm db:reset:test`
// can never be confused for one another. See docs/RUNBOOK.md.
//
// `--env=prod` (Phase 10 Part 6) reads `.env.production.local`, a git-ignored
// file that exists only for the launch session, and runs only with
// `CONFIRM_PROD=1` set and a connection that is neither the dev nor the test
// project (`assertProdTarget`). See docs/LAUNCH.md.
export type DbEnv = "dev" | "test" | "prod";

const ENV_FILE: Record<DbEnv, string> = {
  dev: ".env.local",
  test: ".env.test",
  prod: ".env.production.local",
};

export function loadDbEnv(): DbEnv {
  const arg = process.argv.find((a) => a.startsWith("--env="));
  if (arg !== "--env=dev" && arg !== "--env=test" && arg !== "--env=prod") {
    throw new Error(
      `Missing or invalid --env flag (got ${JSON.stringify(arg)}). ` +
        `This script must be run via its pnpm script (db:*:test, db:*:prod or db:*), ` +
        `never invoked directly without --env=dev|test|prod.`,
    );
  }
  const dbEnv = arg.slice("--env=".length) as DbEnv;
  config({ path: ENV_FILE[dbEnv] });
  if (dbEnv === "prod") {
    assertProdTarget(
      [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.DATABASE_URL, process.env.DIRECT_URL],
      process.env.CONFIRM_PROD,
    );
  }
  return dbEnv;
}

// The dev Supabase project, which served production until the Part 6 cutover.
// Hardcoded for the same reason as the test ref below.
export const DEV_PROJECT_REF = "mipnoxlhurdbaahmvhhx";

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

// Hard guard for prod-targeted scripts: they run only when the operator typed
// CONFIRM_PROD=1 on the command line, every connection value is present, and
// none of them points at the dev or test project. Unlike the test guard it
// can't check for the production ref (it doesn't exist until launch day), so
// it checks for the two refs it must never touch.
export function assertProdTarget(values: (string | undefined)[], confirm: string | undefined) {
  if (confirm !== "1") {
    throw new Error(
      "Refusing to run against production: set CONFIRM_PROD=1 on the command line " +
        "(see docs/LAUNCH.md). This is never set in an env file.",
    );
  }
  if (values.some((v) => !v)) {
    throw new Error(
      "Refusing to run against production: .env.production.local is missing " +
        "NEXT_PUBLIC_SUPABASE_URL, DATABASE_URL or DIRECT_URL.",
    );
  }
  for (const [ref, name] of [
    [DEV_PROJECT_REF, "dev"],
    [TEST_PROJECT_REF, "test"],
  ] as const) {
    if (values.some((v) => v!.includes(ref))) {
      throw new Error(
        `Refusing to run against production: a connection value contains the ${name} ` +
          `project ref "${ref}". .env.production.local must hold the new project's values.`,
      );
    }
  }
}
