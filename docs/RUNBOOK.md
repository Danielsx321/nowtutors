# NowTutors — Runbook

Deploy and third-party configuration checklist. Created in Phase 0 (SPEC §17),
completed through the build. Each item is ticked as it is verified in the target
environment.

## Environments

- **Dev Supabase:** project ref `mipnoxlhurdbaahmvhhx` (eu-west-3). Only environment
  in use during Phase 0. No prod project yet.
- **Deploy target:** Vercel **Hobby**. **There is deliberately no `vercel.json`** — Hobby
  crons run at most **once a day**, which cannot serve a 5-minute presence sweep. Scheduled
  jobs run on Supabase **`pg_cron` + `pg_net`** instead (settled in Phase 6 Part 1; see
  SPEC §3.5/§12 and the pg_cron section below).

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

### Test Supabase project

A disposable `nowtutors-test` Supabase project exists for local seeding and E2E runs, kept
separate from dev/prod so it can be wiped freely. Its credentials live in `.env.test`
(gitignored, never committed — see `.env.test.example` for the key list and comments on
`DATABASE_URL`/`DIRECT_URL`). **Project ref: `uietkphpfqaicbndunwt`.**

**Targeting mechanism:** every db script has a `:test` pnpm variant
(`db:migrate:test`, `db:reset:test`, `db:seed:test`, `db:verify-rls:test`,
`db:generate:test`) that loads `.env.test` instead of `.env.local`. This is the
*only* switch — there is no env-var flag a command can be run with by accident.
Concretely:
- `drizzle-kit` scripts point at a separate `drizzle.config.test.ts` via
  `--config=drizzle.config.test.ts`.
- `tsx`-run scripts (`reset.ts`, `seed.ts`, `verify-rls.ts`) require an explicit
  `--env=dev|test` argument, supplied only by the pnpm script itself — running
  the file directly without it throws.

**Hard guard:** the test project ref (`uietkphpfqaicbndunwt`) is **hardcoded** as
`TEST_PROJECT_REF` in `src/db/load-env.ts`, not read from an env var — a guard
that a forgotten/unset variable can silently disable is not a guard. Every
`:test` script/config aborts with a readable error before doing anything
destructive if the resolved connection string doesn't contain that literal.

**Reset:** `pnpm db:reset:test` drops and recreates the `public`/`drizzle`
schemas on the test project only (guarded as above). There is deliberately no
plain `db:reset:prod`/dev-and-prod-capable reset variant.

**Verified end-to-end (2026-08-23):** `pnpm db:migrate:test` applied the full
0000→0014 migration chain from an empty test database cleanly — 25 tables
landed in `public` (`profiles`, `tutor_profiles`, `bookings`, `wallets`,
`credit_transactions`, etc.), no errors (only benign `DROP TRIGGER IF EXISTS
... does not exist, skipping` NOTICEs from later migrations dropping
not-yet-created triggers). `pnpm db:seed:test` was **not** verified — it failed
locally on this machine with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` from Node's
`fetch` (used by `@supabase/supabase-js` for the admin-user-creation calls),
reproducing even on a plain `fetch('https://supabase.com')`. `curl` to the same
host succeeds, so this is this machine's Node TLS/CA trust store, not the
test project, credentials, or the migration/seed code — needs to be fixed
(or re-run from a machine with a working Node cert store) before the seed step
can be verified.

## Checklist (fill in as the build progresses)

- [ ] Supabase project creation (dev done; prod TBD) and RLS verification steps — Phase 1.
- [ ] Vercel project + env vars per environment (values from `.env.example`).
- [ ] Google OAuth consent screen and redirect URIs — Phase 3.
- [x] PayPal app: sandbox vs live credentials, webhook registration + webhook id — Phase 5.
  **Done for SANDBOX only.** Live is Phase 10 — see the warning below.
  - **Webhook registered (sandbox).** URL `https://nowtutors-brown.vercel.app/api/webhooks/paypal`.
  - **Webhook id (SANDBOX):** `9TL802630X898090D`. This id is **sandbox-only** — a *different* id
    exists for live, and the two are not interchangeable.
  - **Subscribed events:** `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`,
    `PAYMENT.CAPTURE.REFUNDED` — exactly the three the route handles.
  - **Verified 2026-08-22:** a PayPal webhook-simulator delivery returned **200**, with signature
    verification succeeding against the real webhook id (not a stub).
  - **Env vars are set in TWO independent places, and setting one does NOT set the other.**
    `PAYPAL_WEBHOOK_ID`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID`
    and `PAYPAL_ENV` are configured in **Vercel (Production)** *and* must **also** be set separately
    in local **`.env.local`**. Vercel's dashboard and `.env.local` are unrelated stores: adding a
    variable in Vercel does not populate `.env.local`, and adding it locally does not deploy it.
    A missing local value breaks `pnpm dev`; a missing Vercel value breaks production. Set both.
  - `NEXT_PUBLIC_PAYPAL_CLIENT_ID` must match `PAYPAL_CLIENT_ID` for the environment — it is the
    same public value, used by the PayPal JS SDK on the purchase page.
  - ⚠️ **Phase 10 live cutover — the sandbox webhook id will NOT work in live.** Going live needs a
    **separate webhook registered on the LIVE PayPal app**, which issues its **own** webhook id.
    Webhook ids are per-environment and PayPal signs live deliveries against the live id only.
    **Shipping the sandbox id (`9TL802630X898090D`) to production means every live delivery fails
    signature verification and 400s** — the closed-tab backstop silently stops working while client
    capture still appears fine. The live cutover is: register the live webhook, copy its new id into
    the production `PAYPAL_WEBHOOK_ID`, and set `PAYPAL_ENV=live` with the live client id/secret.
    No code change — but it is **not** just flipping `PAYPAL_ENV`.
- [ ] **LessonSpace waiting-room setting (dashboard, not code)** — Phase 7.
- [ ] **`CRON_SECRET`** set in Vercel (per environment) **and** in local `.env.local` — Phase 6
  Part 1. Currently **blank in `.env.local`**, so `/api/cron/sweep-presence` answers **503** locally
  until it is filled. As with the PayPal vars, Vercel and `.env.local` are unrelated stores: set
  both. The value must be byte-identical to the `cron_secret` Vault entry used by pg_cron below —
  a mismatch shows up as a **401** in `net._http_response`, not as a failed job.
- [ ] **pg_cron + pg_net scheduling for `/api/cron/sweep-presence`** — Phase 6 Part 1. Run
  `drizzle/snippets/pg_cron_sweep_presence.sql` **once per environment**, as `postgres`, from the
  Supabase SQL editor (it is not a migration — see the snippet's header for why). Steps:
  1. `create extension` for `pg_cron` (schema `pg_catalog`) and `pg_net` (schema `extensions`).
  2. `vault.create_secret` for `app_base_url` (no trailing slash) and `cron_secret`.
  3. `cron.schedule('sweep-presence', '*/5 * * * *', …)` — the snippet unschedules first, so
     re-running it updates the job rather than duplicating it.
  4. Verify: `select jobid, jobname, schedule, active from cron.job;` then, after five minutes,
     `select status_code, content from net._http_response order by created desc limit 5;` —
     a healthy run returns `{"ok":true,"job":"sweep-presence","swept":N,…}`. **401** = the Vault
     secret and Vercel's `CRON_SECRET` disagree; **503** = `CRON_SECRET` is unset on the deployment.
  The sweep is **tidy-up, not correctness** — the `live_tutors` view protects students at read time
  (SPEC §3.1), so a job that has not been scheduled yet is not an outage.
- [ ] Agora project settings and token-service health check — Phase 6 **Part 3** (still unticked;
  Part 1 built presence only, and the §12 warm-ping to the Render token service is a
  `TODO(Phase 6 Part 3)` in the sweep handler).
- [ ] Resend domain verification and DNS records — Phase 10.
- [ ] DNS cutover for nowtutors.com — Phase 10.
  - **`nowtutors.vercel.app` (no `-brown`) belongs to an unrelated third party. Do NOT point
    nowtutors.com at it.**
- [ ] First-admin promotion SQL — Phase 1/8.
- [ ] Rollback procedure.

## Local setup notes

- Package manager: **pnpm** (`corepack` or `npm i -g pnpm`).
- Copy `.env.example` → `.env.local` and fill values.
- `pnpm install` → `pnpm db:migrate` → `pnpm dev`.
- If Node rejects TLS chains on this machine (`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`
  during `pnpm`/`npm`), export `NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem`. This is a
  local-machine quirk only; CI and Vercel are unaffected.

## Phase 3 — Auth & onboarding (Supabase Auth + Google OAuth)

**Supabase dashboard → Authentication → URL Configuration**
- **Site URL:** the canonical app origin per environment — `http://localhost:3000`
  (dev), the Vercel preview/prod URLs otherwise.
- **Redirect URLs (allow-list):** add every origin that completes an auth flow, each
  with the `/auth/callback` path. Supabase only redirects back to allow-listed URLs.
  - `http://localhost:3000/auth/callback`
  - `https://<vercel-preview>.vercel.app/auth/callback` (or `https://*.vercel.app/auth/callback`)
  - `https://<production-domain>/auth/callback`
  Our code always sends `redirectTo`/`emailRedirectTo` = `${origin}/auth/callback` (OAuth,
  email confirmation → `?next=/onboarding`, password reset → `?next=/reset-password`).

**Google OAuth (Google Cloud Console → APIs & Services)**
- **OAuth consent screen:** External; app name, support email, logo; scopes `email`,
  `profile`, `openid`; add test users while unverified.
- **Credentials → OAuth 2.0 Client ID (Web application):**
  - **Authorized JavaScript origins:** the app origins (localhost + preview + prod).
  - **Authorized redirect URI:** the **Supabase** callback, not ours —
    `https://<project-ref>.supabase.co/auth/v1/callback` (Google returns to Supabase,
    which then returns to our `/auth/callback`).
- Put the Client ID + secret into **Supabase → Authentication → Providers → Google**
  and enable it.

**Account linking (the Google-on-existing-email case — SPEC §7.1)**
- Enable **Authentication → Providers → "Allow linking accounts with the same email"**
  (automatic same-email identity linking). Then a Google sign-in whose email matches an
  existing **confirmed** password account resolves to the **same** auth user — no
  duplicate. Our `profiles` row is keyed by the auth user id and created once by the
  `on_auth_user_created` trigger (`ON CONFLICT DO NOTHING`), so linking never duplicates a
  profile, and `/auth/callback` adds no profile row.
- **Security note:** automatic linking only fires when the pre-existing email is
  **verified**. If the password account is unverified, Supabase creates a **separate**
  identity rather than linking (prevents account takeover of an unconfirmed address).
  This is intended.

**Email templates & confirmation (Authentication → Email Templates / Providers)**
- **Confirm signup, Reset password, Magic link:** ensure the action link points at
  `{{ .SiteURL }}/auth/callback` (append `?next=/onboarding` for confirm, `?next=/reset-password`
  for recovery) so the code lands on our handler.
- The built-in Supabase SMTP sender is **rate-limited (~a few/hour)** — fine for dev
  only. For real signups configure a custom SMTP / Resend (Phase 10). For dev you may
  turn **"Confirm email" OFF** so `signUp` returns a session immediately and routes
  straight to `/onboarding`; with it ON, signup shows a "check your email" state.
- Password minimum length / leaked-password protection can be tightened in
  **Authentication → Policies**; our client+server zod schema already requires ≥8 chars
  with a letter and a number.

### Same-email account linking — automated check

`pnpm db:verify-rls` asserts this rather than trusting the dashboard: it creates a
probe user, tries to create a **second** account with the same email, and requires
that attempt to be **rejected** (then deletes both). That is the observable form of
the SPEC §7.1 no-duplicate-accounts guarantee.

The dashboard flag itself (**Authentication → Sign In / Providers → "Allow multiple
accounts with the same email address"**, which must stay **OFF**) is only readable
through the Supabase **Management API**, which needs a personal access token we
deliberately do not ship in app env — hence asserting the consequence instead.

If that check fails, the setting has been turned on: Google sign-in on an existing
email will create a **second account** instead of linking to the existing one. Fix
it in the dashboard, then re-run `pnpm db:verify-rls`. Run this against **each**
environment (dev, and production before launch) — it is a per-project setting.
