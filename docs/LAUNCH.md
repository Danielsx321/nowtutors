# NowTutors launch (Phase 10 Part 6)

_The cutover script. Written before launch day (2026-09-29), executed top to bottom in one session with Daniels at the keyboard, and kept as the record: every step gets its proof line filled in as it's done. Plan: `plans/2026-09-28-nowtutors-phase-10-email-polish-launch.md` in the Dada Daniels workspace, Step 6._

Owners: **Claude** (SQL, scripts, docs, checks), **Daniels** (dashboards, billing, DNS; Claude can drive them in Chrome with him watching, but never types a password, key or card number), **Noora** (business decisions, Agora console, legal sign-off, the real-card payer).

Secrets never go in this file, a commit or chat. Where a step names a value, it means "the variable of that name", kept in Daniels' password manager.

---

## 0. Decisions needed before launch day

| # | Question | Recommendation | Answer |
|---|---|---|---|
| D1 | Production Supabase region (can't be changed later) | `eu-west-3` (Paris): same as dev and test, and Vercel functions already run in `cdg1` (Paris). Users are in Nigeria and Europe, not the US | **Paris** (Daniels, 2026-10-01); project created there 2026-10-07 |
| D2 | Migrate Bubble data, or launch empty? | Launch empty: tutors sign up fresh and are approved in `/admin`. A data migration is its own project | **Launch empty** (Noora via Daniels, 2026-10-01). The Bubble site is already down |
| D3 | Real-card test: who pays, which package, which day | Noora (or Daniels, refunded by Noora), the smallest package, launch day | _open_: PayPal Live app on Noora's business account comes first (screen share or Daniels added as a user), then the test purchase |
| D4 | Legal pages: company name, address, governing law, support email, minimum age, credit expiry | Noora answers; the `[to confirm: ...]` markers on `/legal/*` are replaced and "Draft for review" switched off | _sent to Noora 2026-09-29_ |
| D5 | Agora App Certificate on (T2) and co-host token setting (T5) | Noora confirms in the Agora console | Daniels has console access: Primary Certificate already on (checked 2026-10-01); co-host setting to check in the new console; not asked of Noora |
| D6 | Payout rate on the new project (`payout_usd_per_credit`) | Keep $1.00 per credit, the value live since 2026-09-14; the settings seed writes it | **Keep $1.00** (Daniels, 2026-10-01) |
| D7 | Whose accounts and card for Vercel, Supabase, Resend | Noora's billing, Daniels as admin | **Changed 2026-10-07:** all production service accounts are on the NowTutors Google account (`nowtutors.pays@gmail.com`), which Daniels operates. Vercel Pro and Supabase Pro paid 2026-10-07 from Noora's launch-month payment. Resend stays Free (3,000/month, 100/day) until sends near 60 a day |
| D8 | Registrar access | Noora on a screen share, or Daniels as delegate | Network Solutions, login is the NowTutors Google address, registrant Noora. Daniels signed in 2026-10-07 |
| D9 | Any `@nowtutors.com` mailbox? Support and DMARC address | Keep MX if any; `hello@` if it exists | No mailbox, no MX, no TXT existed (snapshot 2026-10-07). DMARC reports go to `nowtutors.pays@gmail.com`. Reply-to address still to come from Noora |
| D10 | Launch date; when to cancel Bubble | Weekday morning WAT; cancel Bubble a week after | Bubble already down, nothing to cancel. Launch date: Noora picks; Daniels' 3 Oct note to her said test plans switch to live Monday and public launch waits |

---

## 1. Preparation (before the session)

| Step | Owner | Action | Proof |
|---|---|---|---|
| P1 | Claude | Guarded production scripts on `main`: `db:migrate:prod`, `db:seed:prod-settings`, `db:verify-rls:prod`. Each reads `.env.production.local`, runs only with `CONFIRM_PROD=1` typed on the command line, and refuses the dev (`mipnoxlhurdbaahmvhhx`) or test (`uietkphpfqaicbndunwt`) project | Unit tests `tests/unit/load-env.test.ts`; all three refused with no confirm and no file (2026-09-29) |
| P2 | Claude | Migrations 0021 to 0024 on the current project | Confirmed 2026-09-29, 25 rows in `drizzle.__drizzle_migrations` (PROGRESS) |
| P3 | Claude | The overlapping-bookings note (PROGRESS, "Two confirmed scheduled bookings ... overlapping"). `bookings_no_overlap` is checked on every insert and update and re-validated all rows when 0013 re-added it, so two rows it covers can't overlap: one of the pair was outside its scope (not `scheduled`, not `confirmed`/`in_progress`, or a null time). Production starts empty (D2), so nothing to carry. If data is ever imported, run check C1 below after the import | Reasoning recorded here; C1 is the check |
| P4 | Daniels | Vercel Preview env vars: tick **Preview** with the **test** project's values (`.env.test`), never production's. Fixes every preview answering 500 | A preview URL's `/login` returns 200 |
| P5 | Claude | `pnpm build` on `main` green; `pnpm test:e2e` green on the test project (VPN off, Mac quiet: one run, nothing else heavy) | Output pasted here |
| P6 | Daniels + Claude | Password manager entries ready: new DB password, `CRON_SECRET` (fresh, 32+ random chars), Resend API key, PayPal live client id/secret | Entries exist (names only) |

**Check C1, overlapping scheduled bookings** (SQL editor, any project; returns nothing when clean):

```sql
select a.id, b.id, a.tutor_id, a.scheduled_start_at, a.scheduled_end_at, b.scheduled_start_at, b.scheduled_end_at
from bookings a join bookings b
  on a.tutor_id = b.tutor_id and a.id < b.id
 and tstzrange(a.scheduled_start_at, a.scheduled_end_at) && tstzrange(b.scheduled_start_at, b.scheduled_end_at)
where a.type = 'scheduled' and b.type = 'scheduled'
  and a.status in ('pending_payment','confirmed','in_progress')
  and b.status in ('pending_payment','confirmed','in_progress');
```

---

## 2. Cutover, in order

Stop at any step whose proof doesn't hold. Section 3 undoes everything up to that point.

| # | Owner | Action | Proof |
|---|---|---|---|
| 1 | Daniels (Claude driving) | Supabase: new project `nowtutors-prod` in the NowTutors org, region per D1, strong DB password into the password manager | Project ref: `zcdhwdtvqdeaqrgxskpa`, org `NowTutors Production` (`podeejysztuaykvbygaj`, Pro), eu-west-3, Micro. Created 2026-10-07 |
| 2 | Claude | Write `.env.production.local` (git-ignored) with the new project's `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (transaction pooler `:6543`) and `DIRECT_URL` (session pooler `:5432`, `sslmode=require`). Daniels pastes the secrets into the file himself | Template written 2026-10-07 with the URL filled and four PASTE_ placeholders; not listed by `git status` |
| 3 | Claude | `CONFIRM_PROD=1 pnpm db:migrate:prod` | **Done 2026-10-07** by Daniels from `~/nowtutors`: "migrations applied successfully" (25 files in `drizzle/*.sql`). First DB password had `@` and `!` in it and was reset before this ran; both URLs use the session/transaction pooler host (the `db.<ref>` direct host does not resolve for new projects) |
| 4 | Claude | `CONFIRM_PROD=1 pnpm db:seed:prod-settings` (subjects and settings only, never `db:seed`) | **Done 2026-10-07:** "Production seed done: 26 subjects, 10 settings." |
| 5 | Claude | `CONFIRM_PROD=1 pnpm db:verify-rls:prod` | **Done 2026-10-07:** 22 checks, "Production RLS check passed." |
| 6 | Daniels (Claude driving) | Supabase Auth: Google provider (same client id and secret), same-email linking on, **Confirm email on**; Site URL `https://nowtutors.com`; redirect allow-list `https://nowtutors.com/auth/callback`, `https://www.nowtutors.com/auth/callback`, `https://*.vercel.app/auth/callback`. Google Cloud console: add `https://<ref>.supabase.co/auth/v1/callback` | **Done 2026-10-07.** Site URL and four redirect URLs (the two above plus `nowtutors-brown.vercel.app` and the `*.vercel.app` wildcard) set by Claude; Confirm email was on by default; Google provider on with the same client id (`664583728723-e5n9…`, Cloud project `nowtutors`) and a **second** client secret created for production (Google no longer reveals the original). Google Cloud client got the prod callback and `https://nowtutors.com` as an origin. Rotate that second secret after launch: it passed through chat |
| 7 | Daniels (Claude driving) | Resend: add `nowtutors.com`, put its DKIM/SPF/MX records at the registrar, wait for Verified. **Done 2026-10-07 (domain half):** domain added on the NowTutors Resend account, region eu-west-1; Resend now issues a DKIM TXT plus two sending CNAMEs (`rsend`, `send`) instead of MX + SPF TXT; all four records (with DMARC `p=none`, `rua` to the business inbox) live at Network Solutions and verification started. Supabase Auth → SMTP: host `smtp.resend.com`, port 465, user `resend`, password = Resend API key, sender = `EMAIL_FROM`. Restyle the three auth templates (Confirm signup, Reset password, Magic link) keeping `{{ .ConfirmationURL }}` | **Done 2026-10-07.** Resend shows nowtutors.com Verified; Auth SMTP on (`smtp.resend.com:465`, user `resend`, key `nowtutors-production`, sender `NowTutors <hello@nowtutors.com>`); the three templates restyled on the app's email shell (`emails/shell.tsx` colours). Step 11's confirmation email arrived from the domain |
| 8 | Daniels (Claude driving) | **Done 2026-10-07** (project now in team `nowtutors`, Pro). Vercel → Production env: the five Supabase values from step 2, `NEXT_PUBLIC_APP_URL=https://nowtutors.com`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `CRON_SECRET` (the fresh one), `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `LESSONSPACE_*`, `NEXT_PUBLIC_AGORA_APP_ID`, `AGORA_TOKEN_SERVICE_URL`, and the PayPal set from step 9. Preview keeps the test values (P4) | Eleven values changed or added: the five Supabase values, `NEXT_PUBLIC_APP_URL`, `RESEND_API_KEY` (key `nowtutors-vercel`), `EMAIL_FROM`, `EMAIL_REPLY_TO` (`nowtutors.pays@gmail.com` until Noora names one), fresh `CRON_SECRET`. A redeploy with only half the set slipped through first and was live broken for about 20 minutes; the full redeploy replaced it. P4 (Preview env) still not done |
| 9 | Daniels | PayPal developer dashboard, **Live**: app client id and secret; a new webhook on the live app for `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED` at `https://nowtutors.com/api/webhooks/paypal`; its id into `PAYPAL_WEBHOOK_ID`; `PAYPAL_ENV=live`; `NEXT_PUBLIC_PAYPAL_CLIENT_ID` = live client id | Webhook id: ______ |
| 10 | Claude | Redeploy production. Public pages 200 on the Vercel URL; `curl -H "Authorization: Bearer $CRON_SECRET" <url>/api/cron/sweep-presence` returns zeros from the new project | **Done 2026-10-07:** `/`, `/tutors`, `/live`, `/login`, `/signup`, `/robots.txt`, `/sitemap.xml`, `/legal/terms` all 200 on the vercel.app host, bundles reference only `zcdhwdtvqdeaqrgxskpa`, `x-vercel-id` shows `cdg1`. Sweep: `{"ok":true,"swept":0,"pendingRequestsExpired":0,"broadcastsEnded":0,"agoraWarmPing":{"ok":true,"status":200,"durationMs":12263}}` (the 12 s is the Render free service waking) |
| 11 | Claude (SQL editor) | Noora signs up on production and confirms her email; promote her with the RUNBOOK statement (`update public.profiles set role = 'admin' ... where id = '<her id>'`, no trigger dance needed after 0016), then `select role from profiles where id = ...`. Same for Daniels for the launch window, demoted after | **Done 2026-10-07 for the business account** `nowtutors.pays@gmail.com` (signed up on the vercel.app host; the confirmation link pointed at `nowtutors.com`, still Bubble at that moment, and was completed by opening the same `?code=` on `nowtutors-brown.vercel.app/auth/callback`); row shows `admin`. Noora's own account and Daniels' launch-window admin still to do |
| 12 | Claude (SQL editor) | Vault secrets `app_base_url = https://nowtutors.com` and `cron_secret` = the fresh value, then all seven `drizzle/snippets/pg_cron_*.sql`, sweep-presence first | **Done 2026-10-07:** seven jobs active (booking-reminders, complete-sessions, expire-requests, expire-unpaid, reconcile-wallets, release-earnings, sweep-presence). `app_base_url` is the vercel.app host until step 15 completes, then `vault.update_secret` to `https://nowtutors.com`. `net._http_response` check still owed |
| 13 | Noora or Daniels | LessonSpace dashboard: waiting room on; confirm `LESSONSPACE_API_KEY` is set for Production | Screenshot |
| 14 | Noora | Agora console: D5 confirmed; RUNBOOK "Agora `live` mode check" run once with two browsers | Viewer sees the host |
| 15 | Daniels (registrar) | DNS: `nowtutors.com` and `www` to Vercel exactly as Vercel's Domains page lists. Never `nowtutors.vercel.app` (someone else's). **Prepared 2026-10-07:** both domains added to the project (team `nowtutors`, Pro; `www` is a 308 to the apex). Vercel asks for `A @ 216.150.1.1` and `CNAME www 7b1868df3c2fd635.vercel-dns-017.com`; the four Bubble A records on `@` and `www` are the only records that change. Snapshot: `docs/review/dns-snapshot-2026-10-07.md` | `https://nowtutors.com` serves the app with a valid certificate |
| 16 | Payer per D3, Claude watching | Buy the smallest credit package with a real card on `https://nowtutors.com`. Then, from the PayPal dashboard, resend that webhook event once | Credits land once; `payments` row `captured`; webhook 200; "credits purchased" email arrives; after the resend the balance is unchanged. Balance before ____ after ____ after resend ____ |
| 17 | Noora (student) + Daniels (tutor) | First scheduled booking end to end: book 65 minutes out; confirmation email with `.ics`; 1-hour reminder; classroom join; the session completes; summary; earnings release after the hold; withdrawal request and mark-paid emails | Each email received |
| 18 | Claude | Delete `.env.production.local`. Tick every RUNBOOK launch box with date and proof; PROGRESS "LAUNCHED <date>"; SPEC §16 Phase 10 COMPLETE; update the workspace memories (`production-reads-blocked` gets the new ref) | Docs PR merged |

---

## 3. Rollback

The old setup (the dev project serving production) stays untouched throughout, so going back is repointing, not restoring.

1. **Vercel:** put the Production env vars back to the dev project's values (the password manager keeps the old set until step 18 is a week old), redeploy.
2. **DNS:** if step 15 happened and the app is broken, point `nowtutors.com` back where it was (screenshot the registrar's records before step 15).
3. **Crons on the new project:** `select cron.unschedule(jobid) from cron.job;` so the new project stops calling the app.
4. **PayPal:** set the live webhook inactive (or delete it) if step 16 hasn't passed; sandbox values back in Vercel.
5. **How to tell it worked:** `curl -H "Authorization: Bearer <old CRON_SECRET>" https://nowtutors-brown.vercel.app/api/cron/sweep-presence` answers from the dev project, and a signed-in page shows the old test data.

Anything paid on the new project before a rollback is refunded by hand from the PayPal dashboard and noted here.

---

## 4. First week after launch

Each morning on request: Sentry inbox; the `reconcile-wallets` drift line (0); Resend bounces; `select * from net._http_response where status_code <> 200 order by created desc limit 20`; new tutor sign-ups waiting in `/admin`.
