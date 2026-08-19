import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { sessionPoolerUrl } from "./src/db/session-url";

// drizzle-kit does not auto-load .env.local; load it explicitly.
config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: sessionPoolerUrl(),
  },
});
