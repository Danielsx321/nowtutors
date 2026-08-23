import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { sessionPoolerUrl } from "./src/db/session-url";
import { assertTestProjectRef } from "./src/db/load-env";

// Test-project counterpart to drizzle.config.ts. Loads .env.test instead of
// .env.local, and hard-guards that the resolved connection string actually
// points at the disposable test project. Used via `--config=drizzle.config.test.ts`
// by the db:*:test pnpm scripts — never used directly.
config({ path: ".env.test" });

const url = sessionPoolerUrl();
assertTestProjectRef(url);

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url,
  },
});
