# NowTutors — Decisions Log

Append-only log of non-obvious choices made during the build (per CLAUDE.md). Newest
at the bottom of each phase.

## Phase 0 — Foundation

- **Package manager: pnpm.** Locked by the user. `pnpm-workspace.yaml` carries pnpm
  settings that pnpm 11+ no longer reads from `package.json`.
- **Dev Supabase only** (ref `mipnoxlhurdbaahmvhhx`, eu-west-3). No prod project this phase.
- **No `vercel.json` / no crons.** Deploy target is Vercel Hobby; scheduled jobs are
  deferred to Phase 6 and will likely run on Supabase `pg_cron`. Nothing in Phase 0
  depends on a paid Vercel plan.
- **Sentry is DSN-gated.** Server/edge init runs only when `SENTRY_DSN` is set;
  `next.config.ts` only wraps with `withSentryConfig` when `SENTRY_DSN` is present, so a
  blank DSN never affects local dev or the build. Client instrumentation uses the modern
  `instrumentation-client.ts` file (supported on the installed Next 15.5 + @sentry/nextjs 10).
- **Client Sentry gates on `NEXT_PUBLIC_SENTRY_DSN`, not `SENTRY_DSN`.** *Why:* the browser
  bundle cannot read the server-only `SENTRY_DSN`. *How to apply:* added
  `NEXT_PUBLIC_SENTRY_DSN` to `.env.example`; unset today, so client Sentry is a no-op.
  This is a documented deviation from the SPEC §2.1 env list (one added key).
- **Drizzle client uses `{ prepare: false }`** because `DATABASE_URL` is the Supabase
  transaction pooler.
- **Migrations run over the session pooler (port 5432), not the legacy direct host.**
  *Why:* `db.<ref>.supabase.co` does not resolve on this project; the pooler host does
  (IPv4). *How to apply:* `drizzle.config.ts` prefers `DIRECT_URL` but derives the
  session-pooler URL (`DATABASE_URL` host, port 5432, `sslmode=require`) when `DIRECT_URL`
  is unset or still points at the legacy direct host. See RUNBOOK.
- **`health_check` table is a throwaway** whose only purpose is to exercise
  `db:generate`/`db:migrate` in Phase 0. It can be dropped in Phase 1 when the real
  Section 4 schema lands (migration `drizzle/0000_loud_network.sql`).
- **Native post-install build scripts denied by default** (`pnpm-workspace.yaml`
  `allowBuilds`). Phase 0 needs none of them (sharp = runtime image optimization,
  @sentry/cli = source-map upload requiring an auth token we don't set, esbuild /
  unrs-resolver ship prebuilt platform binaries). Revisit per-package when a phase needs one.
