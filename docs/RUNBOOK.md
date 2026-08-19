# NowTutors — Runbook

Deploy and third-party configuration checklist. Created in Phase 0 (SPEC §17),
completed through the build. Each item is ticked as it is verified in the target
environment.

## Environments

- **Dev Supabase:** project ref `mipnoxlhurdbaahmvhhx` (eu-west-3). Only environment
  in use during Phase 0. No prod project yet.
- **Deploy target:** Vercel **Hobby**. No `vercel.json` / cron entries yet — scheduled
  jobs are deferred to Phase 6 and will likely run on Supabase `pg_cron`, not Vercel.

## Database connections (important)

- `DATABASE_URL` — Supabase **transaction pooler** (`...pooler.supabase.com:6543`).
  Used by the app at runtime via Drizzle (`src/db/index.ts`), initialized with
  `{ prepare: false }` because transaction pooling does not support prepared statements.
- `DIRECT_URL` — intended for migrations. **On this project the legacy direct host
  `db.<ref>.supabase.co` does not resolve (IPv4/DNS).** Migrations therefore use the
  IPv4 **session pooler** (same pooler host, **port 5432**, `sslmode=require`).
  `drizzle.config.ts` prefers `DIRECT_URL` but auto-derives the session-pooler URL from
  `DATABASE_URL` when `DIRECT_URL` is unset or still points at the legacy direct host.
  **Action for prod / new machines:** set `DIRECT_URL` to the session pooler string
  (port 5432) from the Supabase dashboard → Connect.

## Checklist (fill in as the build progresses)

- [ ] Supabase project creation (dev done; prod TBD) and RLS verification steps — Phase 1.
- [ ] Vercel project + env vars per environment (values from `.env.example`).
- [ ] Google OAuth consent screen and redirect URIs — Phase 3.
- [ ] PayPal app: sandbox vs live credentials, webhook registration + webhook id — Phase 5.
- [ ] **LessonSpace waiting-room setting (dashboard, not code)** — Phase 7.
- [ ] Agora project settings and token-service health check — Phase 6.
- [ ] Resend domain verification and DNS records — Phase 10.
- [ ] DNS cutover for nowtutors.com — Phase 10.
- [ ] First-admin promotion SQL — Phase 1/8.
- [ ] Rollback procedure.

## Local setup notes

- Package manager: **pnpm** (`corepack` or `npm i -g pnpm`).
- Copy `.env.example` → `.env.local` and fill values.
- `pnpm install` → `pnpm db:migrate` → `pnpm dev`.
- If Node rejects TLS chains on this machine (`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`
  during `pnpm`/`npm`), export `NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem`. This is a
  local-machine quirk only; CI and Vercel are unaffected.
