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
  - Sandbox `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` are set locally; `PAYPAL_ENV=sandbox`.
  - **`PAYPAL_WEBHOOK_ID` is still blank.** Register the webhook in the PayPal dashboard
    (Apps & Credentials → the app → Add Webhook) pointing at
    `https://<deployment>/api/webhooks/paypal`, subscribed to `PAYMENT.CAPTURE.COMPLETED`,
    `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`; copy the generated webhook id into
    `PAYPAL_WEBHOOK_ID`. **Until it is set the webhook route returns 503 and processes nothing** —
    client-side capture still works, but the closed-tab backstop does not.
  - Going live is env-only: `PAYPAL_ENV=live` plus the live client id/secret and a **separate**
    live webhook registration (webhook ids are per-environment). No code change.
  - `NEXT_PUBLIC_PAYPAL_CLIENT_ID` must match `PAYPAL_CLIENT_ID` for the environment — it is the
    same public value, used by the PayPal JS SDK on the purchase page (Phase 5 Part 2).
- [ ] **LessonSpace waiting-room setting (dashboard, not code)** — Phase 7.
- [ ] Agora project settings and token-service health check — Phase 6.
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
