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

## Phase 1 — Data layer (schema decisions)

Resolved with the user before the first Phase 1 migration. These fill spec holes in
§4/§5/§7/§11/§12. Each schema-changing commit also amends SPEC §4 (per CLAUDE.md).

- **`notification_preferences` on `profiles`** (fills the §11 gap). Column
  `notification_preferences jsonb not null default '{}'::jsonb`. **Opt-out model:** a
  missing key = "on". *How to apply:* app reads via a zod schema whose defaults are
  `booking_confirmations` / `reminders` / `messages` = true, `marketing` = false; email
  code checks e.g. `prefs.reminders !== false`.
- **Reminder idempotency on `bookings`** (fills the §12 gap). Columns
  `reminder_24h_sent_at timestamptz` and `reminder_1h_sent_at timestamptz`, both nullable,
  no default. *How to apply:* `booking-reminders` cron selects `WHERE <col> IS NULL` and
  stamps the column on send.
- **Instant-session hold via the ledger** (fills the §7.4 / §4.4 gap). Add to the
  `credit_transactions.type` enum: `instant_hold`, `instant_release`, `instant_capture`.
  *Semantics:* session start inserts `instant_hold` with delta `-(rate * max_instant_minutes)`;
  if that would drive the wallet below 0 the session cannot start. Session end (actual
  minutes `m`) inserts `instant_release` `+(rate * max_instant_minutes)` **and**
  `instant_capture` `-(rate * m)`; net across the three rows = `-(rate * m)`. *Why:* the full
  max is held upfront, so the student can never overspend — the session **hard-stops** at
  `max_instant_minutes` (client warns ~2 min before). Resolves the unspecified
  "runs out mid-session" path.
- **Two new `platform_settings` keys** (referenced by §7.4, absent from §4.7):
  `max_instant_minutes` (default 60) and `min_instant_credits` (default 5 — placeholder,
  retune once Q9 instant pricing is confirmed by the client). Settings rows, not code.
- **`profiles.role` is nullable** (resolves §7.1 vs §4.1). `role` is the `user_role` enum
  (`student` | `tutor` | `admin`), **NULLABLE, no default**. The signup trigger inserts a
  `profiles` row with `role` NULL; onboarding sets it. Null role = onboarding incomplete;
  route guards gate on it. **Do not** add a `pending` enum value.
- **Booking overlap prevention** (nails the vague §4.3 index). `create extension if not
  exists btree_gist;` then a scheduled-only GiST exclusion:
  `exclude using gist (tutor_id with =, tstzrange(scheduled_start_at, scheduled_end_at) with &&)`
  `where (type = 'scheduled' and status in ('confirmed','in_progress'))`. The `WHERE` keeps
  instant bookings (null times, `in_progress`) out of the index so only real scheduled slots
  collide.
- **View safety (confirmed split).** Both views enumerate columns explicitly — never
  `SELECT *`. `live_tutors` is **`security_invoker = on`**: its base table `tutor_profiles`
  already permits public read of approved rows, so invoker rights are correct and safe.
  `public_profiles` is **SECURITY DEFINER**, exposing only `id, display_name, avatar_url,
  country, bio`. *Why the split:* `public_profiles` must show safe columns of **other** users
  while `profiles` base RLS is own-row-only; `security_invoker` would return only the caller's
  own row and defeat the view. The explicit column list preserves the "don't leak everything"
  intent of the original decision.
- **Single source for presence staleness.** The 2-minute staleness threshold is baked
  directly into the `live_tutors` view definition via the migration, and the
  `platform_settings.presence_stale_seconds` key is **deleted**. The view and the
  presence-cleanup cron must not each carry their own copy of the threshold.

### Phase 1 — reconciliation with the Bubble export

Applied after diffing SPEC §4 against the current Bubble data types. These override the
inferred spec where the export disagrees; SPEC §4 amended in the same commit.

- **Payout privacy (Decision A).** `paypal_email` and payout method move off `tutor_profiles`
  into a new **`tutor_payout_details`** table (`tutor_id unique FK, payout_method, paypal_email`)
  with **owner + admin-only RLS**. Keeps "anyone reads approved `tutor_profiles`" from leaking
  payout data. Documented deviation from SPEC §4.1.
- **`profiles.phone` dropped** — no such field exists in the Bubble build.
- **Reviews deferred** — no Review type exists in Bubble; not a current feature. **No `reviews`
  table** this build. Ratings are a plain denormalized scalar on `tutor_profiles`
  (`rating_avg numeric(3,2) default 0`, `rating_count integer default 0`) with nothing writing
  them yet. No published-reviews anon grant. Revisit if reviews become a feature.
- **`broadcasts` + `broadcast_viewers` are NET-NEW**, not parity — kept in the schema
  (`broadcast_viewers.user_id` nullable for anonymous viewers) but flagged as new functionality
  beyond the current build.
- **No separate instant-rate.** `tutor_profiles.instant_rate_credits_per_minute` is made
  **nullable** (was `not null` in spec §4.1). Instant per-minute price **derives from
  `hourly_rate_credits / 60`**. The instant-hold math (see the ledger decision above) uses this
  derived rate: `rate = hourly_rate_credits / 60`.
- **Additive tutor fields are nullable / non-gating.** `headline`, `languages`, `education`,
  `years_experience`, `intro_video_url`, and `tutor_subjects.level` are additions beyond the
  current build — all nullable, and no route guard or flow gates on them.
- **Seed placeholders (Decision D).** `platform_settings` values are provisional pending
  SPEC §18 answers. Credit packages seeded at **1 credit = 1 minute** (credits ≡ minutes). The
  seed subject list is a placeholder pending the real Bubble Subjects export.
