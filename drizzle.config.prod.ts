import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { sessionPoolerUrl } from "./src/db/session-url";
import { assertProdTarget } from "./src/db/load-env";

// Production counterpart to drizzle.config.ts (Phase 10 Part 6). Loads the
// git-ignored .env.production.local and refuses unless CONFIRM_PROD=1 is set
// and no connection value points at the dev or test project. Used only via
// `pnpm db:migrate:prod` on launch day (docs/LAUNCH.md).
config({ path: ".env.production.local" });

assertProdTarget(
  [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.DATABASE_URL, process.env.DIRECT_URL],
  process.env.CONFIRM_PROD,
);

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: sessionPoolerUrl(),
  },
});
