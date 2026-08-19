// Direct/session connection string for migrations and admin scripts (reset,
// seed helpers). Prefers DIRECT_URL, but derives the Supabase IPv4 session
// pooler from DATABASE_URL when DIRECT_URL is unset or still points at the
// legacy direct host (db.<ref>.supabase.co, which does not resolve here).
// See docs/DECISIONS.md and docs/RUNBOOK.md.
export function sessionPoolerUrl(): string {
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
