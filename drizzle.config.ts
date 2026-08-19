import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit does not auto-load .env.local; load it explicitly.
config({ path: ".env.local" });

// Migrations run over a direct/session connection (not the transaction pooler).
// On this Supabase project the legacy direct host `db.<ref>.supabase.co` is not
// resolvable, so when DIRECT_URL is unset or still points at that host we derive
// the IPv4 session-pooler URL from DATABASE_URL (same host, port 5432, TLS).
// See docs/RUNBOOK.md and docs/DECISIONS.md.
function migrationUrl(): string {
  const direct = process.env.DIRECT_URL;
  const isLegacyDirect =
    !!direct && /(^|@)db\.[^.]+\.supabase\.co(:|\/|$)/.test(direct);
  if (direct && !isLegacyDirect) return direct;

  const pooled = process.env.DATABASE_URL;
  if (!pooled) {
    throw new Error("No usable DIRECT_URL and no DATABASE_URL to derive from");
  }
  const u = new URL(pooled);
  u.port = "5432";
  u.searchParams.set("sslmode", "require");
  return u.toString();
}

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: migrationUrl(),
  },
});
