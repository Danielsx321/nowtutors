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

## Phase 2 — Design system

Approved with the user before building (scope + deps). Implements SPEC §10.1/§10.2 and
the §16 Phase 2 layouts. No data/auth work.

- **Scope: primitives only.** Phase 2 builds the **34 §10.2 primitives** + layouts. The 11
  **Composed** components (`TutorCard`, `BookingCard`, `SlotPicker`, `AvailabilityGrid`,
  `MessageBubble`, `ConversationListItem`, `TransactionRow`, `VideoTile`, `SessionControlBar`,
  `IncomingRequestModal`, `WaitingForTutorModal`) are **deferred to their feature phases**
  (they bind to domain data that doesn't exist yet — TutorCard→P3, BookingCard/Slot/Grid→P4,
  Transaction→P5, session ones→P6, message ones→P9). Matches §16's "every primitive" wording.
- **Dependencies added** (approved; all flow from §2's `shadcn/ui (Radix under the hood)` +
  `date-fns`, none named literally so confirmed explicitly): `class-variance-authority`,
  `clsx`, `tailwind-merge`, `lucide-react`, `sonner`, `react-day-picker`, `date-fns`, and
  `@radix-ui/react-{dialog,tabs,tooltip,dropdown-menu,switch,checkbox,radio-group,select,label,slot}`.
  All pure-JS → no `pnpm-workspace.yaml allowBuilds` change.
- **No `@radix-ui/react-popover`.** Modal **and** Drawer are both built on `@radix-ui/react-dialog`
  (Drawer = side-positioned Dialog). DatePicker uses a **local popover** (open state + outside-
  pointer/Escape close) — avoids a dependency not on the approved list.
- **Third-party palettes mapped to tokens** (amendment #2). `sonner` runs `unstyled` with full
  `classNames` overrides; `react-day-picker` is used **without importing its stylesheet**, all
  colour via `classNames`. So neither ships its own palette and the brand grep stays clean.
- **Token additions to `globals.css`** (the one allowed home for raw values): paired type-scale
  tokens (`--text-h1` + `--text-h1--line-height`, amendment #3) for every §10.1 step; `--shadow-*`;
  `container-page` + `focus-ring` `@utility`s; **hand-rolled Radix enter/exit keyframes** (no
  animation dependency, amendment #4) driven by `data-slot`/`data-state`, all gated under a global
  `prefers-reduced-motion` block.
- **Button variants = primary/secondary/ghost/danger** (§10.2). `primary` is **purple**
  (§10.1: "purple — buttons"); **gold is reserved for CTA emphasis** and is deliberately not a
  Button variant (§10.1 rule: gold for primary CTAs only).
- **Surface toggle catches purple-on-ink (amendment #1).** The kitchen sink renders every
  primitive on a light surface and on ink-900 via a toggle. Finding, as expected from §10.1:
  **on-surface-text primitives** (Ghost `Button`, `Breadcrumb`, `Pagination`, `PriceTag`/
  `RatingStars` labels) use dark text and are **light-surface components** — low-contrast if
  placed bare on ink. The dark authenticated shell composes them on white `Card`s, and its own
  chrome (`SidebarNav`) uses light-on-dark with purple only as an active **fill**. `Card`/
  `StatCard` carry an explicit `surface="ink"` variant; `LivePill` and fill-based `Badge`s are
  surface-agnostic.
- **Ink chrome vs light surfaces — the dividing line.** **⚠️ SUPERSEDED** by *"Ink shell +
  ink cards — the Phase 2 ink amendment"* at the bottom of this section (wrong on parity against
  the live Bubble build; kept here as history). Original ruling:
  Keep the ink surface area small: **ink chrome = the desktop sidebar and the mobile nav drawer
  only.** The **topbar is a light surface** (`bg-white`) — `CreditBalance`, ghost icon `Button`s,
  and (in Phase 3) `Breadcrumb` compose there as-is with no ink treatment. All content areas are
  light. Pattern: **dark sidebar + white topbar + white content.**
  - The one real dark-chrome gap fixed this phase was the **mobile drawer close button**: it now
    reads light-on-dark (`text-gray-200`, ink-800 hover, white hover text) to match the dark
    `DrawerContent` that wraps the `SidebarNav`. The sidebar/drawer nav itself was already
    ink-treated (`SidebarNav`: light text, purple only as an active fill).
  - `Breadcrumb`, `Pagination`, `PriceTag`, `RatingStars` labels stay light-surface with **no**
    surface variant — they live in light content areas (and light topbars) and never render on
    ink. Keeping the topbar light is what keeps that true.
  - *(History: a topbar-ink treatment was briefly added and reverted — the premise that the
    topbar was dark chrome was wrong; an ink topbar would have put `Breadcrumb` on ink in Phase 3
    and contradicted the line above.)*
- **No `setInterval` in the kitchen sink** (honours the CLAUDE.md polling rule). `ProgressRing`'s
  `live` prop wires `role="timer"` + `aria-live`; the real per-second tick is the Phase 6
  instant-request flow, not a demo loop.
- **Filenames: kebab-case** in `components/ui/` (shadcn copy-in convention), imported via the
  `@/components/ui` barrel.
- **Single `/` resolver.** `src/app/page.tsx` moved to `src/app/(public)/page.tsx` so only the
  (public) group resolves `/`. Public shell (header/footer) and the authenticated shell
  (`AppShell`: dark sidebar + topbar + mobile drawer) are **presentational only** — the §6 role
  guards (`requireRole`, tutor-approval gate) land in Phase 3. Nav is the static §6 config.
- **`/dev/*` is dev-only.** `src/app/dev/layout.tsx` returns `notFound()` in production so the
  kitchen-sink gallery never ships to real users.
- **Avatar** hand-built (no `@radix-ui/react-avatar`) with an initials fallback that also fires on
  image `onError`, so the "photos not rendering" failure never shows a broken image (§7.2).

- **`cn()` knows the §10.1 type scale — app-wide `tailwind-merge` fix (`src/lib/utils.ts`).**
  Default `tailwind-merge` does not recognise our custom size tokens (`text-display`, `text-h1`,
  `text-h2`, `text-h3`, `text-body-lg`, `text-body`, `text-small`, `text-caption`) and mistakes
  them for text-**colour** utilities. So any `cn(...)` that combined a size token with a colour
  silently **dropped one of them**: `cn("text-white", "text-h2 font-bold")` collapsed to
  `text-h2 font-bold` (colour lost), and a heading/label that paired a size with a colour lost its
  **size** and rendered at an inherited size instead. Registered the type scale as a `font-size`
  group via `extendTailwindMerge` so colour and size coexist; genuine colour↔colour and size↔size
  conflicts still resolve last-wins (verified). **This changes rendered output everywhere `cn()`
  merged a size token with a colour — it affects every component built before this commit,
  including the Phase 3 checkpoint `cf4e5b8`** (e.g. `PriceTag` previously shipped with no colour
  class at all, only *looking* right by inheriting from its container; section `h2`s and `StatCard`
  labels were rendering at inherited sizes). Kept as its own commit + this log entry because a
  behaviour change this broad must be findable outside a commit message. Surfaced while building the
  Phase 2 ink `PriceTag`/`RatingStars` (the ink numerals fell back to black), but the fix stands on
  its own and lands ahead of the ink amendment.

### Phase 2 ink amendment (2026-08-20) — before PR merge

- **Ink shell + ink cards — supersedes the "ink chrome = sidebar + drawer only" ruling above.**
  Review against the live Bubble build showed the earlier dividing line was wrong on parity. The
  Bubble original is an **ink shell (sidebar + topbar) wrapping a white content panel, with ink
  cards inside that panel** — ink shell → white panel → ink cards. The Phase 2 PR was still held,
  so this is an amendment on the branch, not a revert of a merged decision.
  - **One ink surface, sampled from Bubble.** `ink-900 = #34495E`; the whole ink ramp is a hue-210
    ramp derived from it (`ink-950/900/800/700/300`). Sidebar and cards are the **same** value —
    a card reads distinct only because it sits on the white panel (or, on ink, by an `ink-700`
    border). The old purple ink (`#332042`) is gone.
  - **`ink-800` reclassified: surface → interaction state.** With a single ink surface there is no
    lighter ink to elevate onto, so a card/dropdown/drawer on ink separates by an `ink-700` border
    or a shadow, never by a lighter fill. `ink-800` is now hover/pressed only; `ink-950` is the
    darker recess (active nav item, modal/drawer scrim, StatCard icon chip).
  - **Topbar flips light → ink**, reversing the "white topbar" call above. `AppShell` is now
    `bg-ink-900` frame → `Topbar` `bg-ink-900` → white `main` panel (`md:rounded-tl-lg`). Topbar
    controls take on-ink treatment (white ghost buttons, `ink-800` hover, gold focus ring,
    `CreditBalance tone="ink"` separated by an `ink-700` border rather than an `ink-800` fill).
  - **Purple is fill-only on ink, measured.** White-on-purple-500 = 6.91:1 (OK as a fill); purple
    text/border/ring on ink = **1.34:1**, failing both the 4.5:1 text floor and the 3:1 non-text
    floor. Recorded in SPEC §10.1 so it is not re-litigated. Gold (7.22:1) carries CTAs, focus
    rings, and active accents on ink; secondary text on ink is `ink-300` (4.69:1).
  - **Dual focus rings (SPEC §10.3).** Split the single purple ring into `--focus-ring` (purple,
    light) and `--focus-ring-on-ink` (gold, ink), with a matching `.focus-ring-on-ink` utility.
    Wired ink-surface chrome (sidebar nav, topbar controls, drawer) to the gold ring. A purple ring
    on ink is invisible — this is an a11y fix, not a preference.
  - **LIVE badge lightened, not the green darkened.** New `live-400 = #4FD179` as the badge fill
    carrying `ink-900` text (4.75:1); `live-500` stays for non-text indicators (dots, pulses). The
    `TutorCard` LIVE badge that consumes it lands on the Phase 3 rebase (below).
  - **Density pass (token/scale level, not per-page).** Desktop page gutter 32→24; `Card`/`StatCard`
    padding `p-5`→`p-4`. Browse grid gap / filter-rail width are browse-specific and land with the
    browse view on the rebase, so the eight unbuilt Phase 3 pages inherit the tighter rhythm from
    the tokens rather than from hand-tuned browse edits. **Caveat (see the rebase list):** this pass
    was calibrated against a render made *before* the `cn()` type-scale fix (separate commit), which
    was suppressing font sizes — so the tightening must be re-evaluated against correct type sizes,
    not assumed.

- **Amendment scope split — what shipped here vs. what's pending on the Phase 3 rebase.** `TutorCard`
  is a **composed Phase 3 component** that lives only on `phase-3-auth-onboarding-browse` (`cf4e5b8`),
  not on this branch; copying it onto `phase-2-design-system` would duplicate it across branches and
  conflict on the scheduled rebase. So the amendment was partitioned (user-approved):
  - **Shipped in this commit (phase-2):** the ink token ramp + focus tokens; `PriceTag` and
    `RatingStars` ink variants (Phase 2 primitives, needed now even though their consumer lands
    later — this reverses their earlier "light-surface-only" note); `Card`/`StatCard` ink surface on
    `ink-900`+`ink-700`; the ink shell (`AppShell`/`Topbar`/`Sidebar`); dual focus rings; the density
    pass; the kitchen-sink Foundations section (ramp swatches, both focus rings, the `ink-800` hover
    demo); and all of the above documentation.
  - **Pending on the Phase 3 rebase (do first, before resuming the batch):** (1) restyle `TutorCard`
    per the amendment — `ink-900` surface, `ink-700` border, white name/price, `ink-300` secondary,
    `ink-800` subject chips, `live-400` LIVE fill with `ink-900` text, `ink-800` hover,
    `focus-ring-on-ink`; (2) add the ink `TutorCard` (all three live states) to the kitchen sink; (3)
    verify the browse view renders ink shell → white panel → ink cards at Bubble-comparable density,
    incl. the browse grid gap + filter-rail width; (4) **re-evaluate the density pass against correct
    type sizes** — the "too sparse" read that motivated the tightening came from a screenshot taken
    while the `cn()` bug was suppressing font sizes, so the calibration was against a broken render.
    Verify, don't assume. `liveStatus` still derives from `live_tutors`, never `is_live` — untouched.
  - **Subject-name corrections (added 2026-08-20, §18 resolution).** Two corrections to the canonical
    26-subject list, which lives only on `phase-3-auth-onboarding-browse` (`cf4e5b8`), **not on
    `main`**. They are queued here rather than applied because porting the list to `main`'s seed would
    create a `seed.ts` conflict on the rebase — the **same reasoning as the `TutorCard` deferral**
    above. Apply during the rebase:
    - #3  `"English as a Second Language"` → `"English as a Second Language (ESL)"`
    - #11 `"Live IELTS / TOEFL Speaking"` → `"Live IELTS / TOEFL Speaking Prep"`
    - #6 (`IELTS / TOEFL Essay Proofreading`) and #10 (`Data Science & Machine Learning`) confirmed
      **correct as seeded** — no change.
    Slugs derive from the name via `slugify()` in that seed, so they update automatically. `main`'s
    seed keeps its 8 dev placeholders in the meantime.

## Phase-agnostic — §18 resolution (2026-08-20)

The SPEC §18 open questions were settled with the user and applied to `main` in a **docs + seed
commit** (no application code, no schema change). SPEC §18 rewritten from questions to resolutions;
§7.3, §7.4, §4.1, §4.4, §4.7 updated in the same commit (per the CLAUDE.md standing rule). Non-obvious
choices recorded here:

- **Instant billing is flat, upfront — the Bubble metering bug was NOT ported ("bug not ported,
  intended behaviour built").** The Bubble build runs a **180 ms client `setInterval`** that
  decrements a `credits_remaining` field, which is a **units bug**: at ~5.5 ticks/second a 60-minute
  session would drain to zero in **~4 seconds**. We deleted the entire authorization-hold /
  per-minute / release-the-remainder model from §7.4 and replaced it with: charge `duration_minutes
  / 3` credits **upfront at booking creation** (30→10, 60→20, 90→30), one `booking_debit` ledger row
  in the same transaction; **no metering, no hold, no partial refund, no remainder release**. Session
  length is enforced **server-side from `bookings.started_at`** — elapsed time is never read off a
  client interval. *Why record it:* the temptation on a "parity" build is to reproduce the existing
  behaviour; here the existing behaviour is a defect, so the intended behaviour is built instead and
  the divergence is deliberate.
- **`instant_rate_credits_per_minute` stays dropped in spirit — retained-but-unused, not deleted.**
  §4.1 keeps the (nullable) column; instant price now derives from the booked **duration**
  (`duration_minutes / 3`), not a per-minute rate, so the column is unused. It is **not** removed
  from the schema: this was a docs + seed commit, and dropping a column is a migration (CLAUDE.md:
  no schema change without a §4 amendment in the same commit). The `instant_hold` / `instant_release`
  / `instant_capture` credit-transaction enum values are likewise now unused but retained; an enum
  cleanup can be a later migration if wanted.
- **No cancellation, no refunds — admin force-cancel is the only unwind (§7.3).** Neither student nor
  tutor can cancel; there is no refund on the normal path (`cancellation_enabled = false`). The
  booking-status values `cancelled_by_student` / `cancelled_by_tutor` / `no_show_student` /
  `no_show_tutor` are **kept in the enum** but are now **admin- or cron-set only, never user-set**.
  Removed `cancellation_window_hours`.
- **`$30` minimum withdrawal is enforced server-side, not only by a disabled button.** The Bubble
  build enforces the minimum **client-side only** (a button conditional, no backend validation) — a
  gap that does **not** carry over. The withdrawal server action must validate `amount_usd >= 30`
  itself and reject below that, independent of any client state. Seeded as `min_withdrawal_usd = 30`
  (replaces the old `min_withdrawal_credits`). *Wiring the check itself is Phase 8 code, out of this
  docs commit — recorded so it is not forgotten.*
- **Credit packages seed no `minutes` column.** Five real Bubble tiers seeded as credits + USD price
  only: Starter 5cr/$9.99, Standard 15cr/$24.99, Popular 30cr/$39.99, Pro 60cr/$67.99, Premium
  100cr/$97.99. Bubble's per-package "minutes" labels imply ratios of **3.0 / 2.0 / 2.0 / 1.67 / 1.2
  min-per-credit** while the code charges at a flat **3** — the labels are inconsistent marketing
  copy, so they are **not** seeded. The purchase page shows **credits + price** plus a single line
  stating **1 credit = 3 minutes**. *Why:* seeding the inconsistent per-package minutes would bake a
  contradiction into the data.
- **`credit_usd_rate` removed; price is per-package.** With five fixed tiers there is no single
  USD-per-credit rate (the tiers span $2.00→$0.98 per credit), so the old flat `credit_usd_rate`
  setting is gone. Amounts remain computed server-side from the package the client names (§7 intent
  model), never a client-sent price.
- **Settings keys removed by this resolution:** `credit_usd_rate`, `min_withdrawal_credits`,
  `cancellation_window_hours`, `max_instant_minutes`, `min_instant_credits`. **Added:**
  `credit_minutes_ratio` (3), `session_durations` (`[30,60,90]`), `cancellation_enabled` (false),
  `min_withdrawal_usd` (30). **Changed:** `platform_fee_percent` 20→25, `earnings_hold_hours` 72→48,
  `max_booking_days_ahead` 30→7. **Kept:** `min_booking_notice_minutes` (120, existing default),
  `instant_request_ttl_seconds` (60 — the instant-request accept window, unaffected by billing).
- **Earnings fee rounds DOWN, remainder to the tutor — authoritative, not a fixture choice
  (SPEC §7.11).** `platform_fee_credits = floor(gross_credits × platform_fee_percent / 100)`;
  `net_credits = gross_credits − platform_fee_credits`. *Why floor:* rounding against the payee
  accumulates in the platform's favour across many small sessions; rounding the fee down costs the
  platform fractions of a credit per session and is the defensible direction. *Why now, and why one
  function:* a 10-credit charge at 25% is 2.5 credits — integer splits are unavoidable, and if the
  seed and the Phase 5 pipeline each pick their own rounding they diverge silently. So the rule lives
  in a single exported helper, **`src/lib/credits/fees.ts` → `splitEarnings(gross, feePercent)`**,
  which the seed calls and Phase 5 must call too (the only application code in this otherwise
  docs+seed change). Supersedes the earlier round-half-up comment on the seed fixture. Instant sample
  earnings are now gross 10 / fee 2 / net 8 (was 3/7).
- **§18 Q3 (broadcast chat) was NOT in the resolution batch.** The user's answer set covered every
  §18 item except broadcast chat. Recorded as **deferred**, grounded in the existing Phase 1 decision
  that broadcasts are **net-new** functionality beyond current parity — so broadcast chat is decided
  at the broadcast phase, not a v1-parity question. Flagged to the user; revisit if that framing is
  wrong.

## Phase 3 — Auth, onboarding, profiles, browse

Decided with the user (plan approved). This commit is the **browse checkpoint** — see
`docs/PROGRESS.md` for what is built vs still to build.

- **Canonical option sets (Bubble).** Subjects seeded to the **26** canonical names, `sort_order`
  1..26. Two were corrected during the Phase 2→3 rebase per the §18 resolution: **#3 →
  "English as a Second Language (ESL)"** and **#11 → "Live IELTS / TOEFL Speaking Prep"**; **#6
  "IELTS / TOEFL Essay Proofreading" and #10 "Data Science & Machine Learning" were confirmed
  correct as seeded** (see the "Subject-name corrections" note in the Phase 2 ink-amendment section).
  Languages: the 9-value set. Role enum stays `student | tutor | admin` (Bubble has only
  Student/Tutor; admin is kept — §5 depends on it). Country stored ISO 3166-1 alpha-2, full list
  offered in the UI (Bubble's 8-country set was a limitation).
- **Favourites is a PARITY feature the spec missed.** New `favourites` table (SPEC §4.8, migration
  `0008`), student-own RLS, a guarded `toggleFavourite` student-only action, browse left-joins the
  viewer's favourites for per-card state. **Anon heart renders and routes to `/login`**;
  tutor/admin viewers don't see it. Favourites list lives at **`/dashboard/favourites`**.
- **`/` is the browse experience at parity, `/tutors` redirects to it** (search params forwarded).
  No marketing landing page and no stub — that's a possible future addition, not this rebuild.
- **Card live status derives from the `live_tutors` view, never `is_live`** (§3.1). The browse query
  LEFT JOINs the view and passes a derived `liveStatus` to `TutorCard`: `offline` (not in view),
  `online` (`live_mode='instant'`, badge only), `live` (`live_mode='broadcast'`, badge + video
  preview). Phase 6's video tile keys off `live` only. `is_live` is never selected for card logic.
- **Price bands (USD) → credits via an injected rate.** `composeTutorFilters(query, { usdPerCredit })`
  converts band USD bounds to credit bounds; `usdPerCredit` is read from
  `platform_settings.credit_usd_rate` through the cached `lib/settings.ts` accessor and injected —
  never a constant in the filter module. The USD↔credits value stays a Noora settings question.
  Bands: Under $15/hr · $15–25 · $25–50 · $50–100 · $100+.
- **Filter composition is a standalone, DB-free pure function** (`src/lib/tutors/filters.ts`):
  `parseTutorSearchParams` (URL → normalized query, invalid/blank dropped) + `composeTutorFilters`
  (only-set-filters → Drizzle conditions). 30 unit tests, exhaustive over every set/unset
  combination (`tests/unit/tutor-filters.test.ts`). This is the anti-`ignore_empty_constraints`
  guarantee (§3.3, §15).
- **Rating filter/sort supported but NOT surfaced in v1.** Reviews are deferred and `rating_avg`
  is 0 for everyone, so a rating control/sort would return empty. `minRating` lives in the parser +
  composer + tests; no UI control and no `rating` sort option. Lights up when reviews ship.
- **Browse reads `public_profiles` + approved `tutor_profiles`; suspended owners excluded via base
  `profiles`.** The two views are modelled with Drizzle `.existing()` in `src/db/schema/views.ts`
  (queried, never generated). `public_profiles` doesn't expose `is_suspended`, so the exclusion
  joins base `profiles.is_suspended = false` — a documented, intentional deviation from
  "public_profiles only".
- **Storage / avatars (the named Bubble bug).** Migration `0007_storage_avatars.sql` creates a
  **public `avatars` bucket** + `storage.objects` policies (public read; write only inside
  `{uid}/`). `next.config.ts` adds `images.remotePatterns` for the Supabase public storage path;
  `Avatar` now renders via `next/image`.
- **Migration numbering.** `0007` (storage) is a custom SQL migration whose meta snapshot copies
  `0006` (it changes no Drizzle-tracked table) with a fresh id/prevId; `0008` (favourites) was
  produced by `drizzle-kit generate --name favourites` against the extended chain, then the RLS
  block appended. `0007` then `0008` apply clean from empty.
- **Seed suspended-owner fixture.** `profiles_guard` (drizzle/0003) correctly blocks non-admins
  (incl. the service role) from changing `is_suspended`. The seed sets the one suspended fixture as
  the table owner with `ALTER TABLE ... DISABLE/ENABLE TRIGGER profiles_guard` around a single
  UPDATE — seed-only; the trigger stays the backstop for the app.
- **New dependencies** (SPEC §2): `@supabase/ssr`, `zod`, `react-hook-form`, `@hookform/resolvers`.
  Country list is a static constant, not a package. Vitest gained an `@` path alias.
- **Guards** (`src/lib/auth/guards.ts`): `getUser` / `getSessionProfile` / `getViewer` /
  `requireUser` / `requireOnboarded` / `requireRole`. Built this checkpoint; **wiring into the
  `(student)`/`(tutor)`/`admin` layouts and every action is part of the next batch** (§5: never
  rely on the layout alone).
- **Dev email (planned, not this commit).** Supabase's built-in auth email sender is rate-limited
  (~a couple/hour) and unusable for real signups; for dev we disable "Confirm email", and Resend
  wires in Phase 10. Google same-email account linking must be enabled in the dashboard so OAuth on
  an existing email links rather than duplicates (§7.1). RUNBOOK items for the auth batch.

## Phase-agnostic — credits are money, not time (2026-08-20, supersedes §18 item 7)

- **A credit is a purchased currency, not a unit of time.** The §18 resolution "1 credit = 3
  minutes" (`credit_minutes_ratio = 3`) is **withdrawn entirely**. *Why:* a credit cannot be both a
  time unit and a money unit at once — the two readings conflict the moment tutors price
  differently. Tutors set `hourly_rate_credits` **freely** and it is **authoritative for price**;
  differentiated per-tutor rates (the seed already spans 20 → 240 cr/hr) are only meaningful if a
  credit is money. A fixed minutes-per-credit ratio would make every tutor's effective hourly price
  identical in time terms, which contradicts having a rate field at all.
- **One pricing formula, scheduled and instant.** `price_credits = hourly_rate_credits ×
  duration_minutes / 60`, **rounded up**. The old instant rule (`duration_minutes / 3`, a flat
  10/20/30 for 30/60/90) is gone — instant now prices off the tutor's hourly rate exactly like a
  scheduled booking. The upfront/no-hold/no-metering/no-refund shape of instant billing is
  unchanged (§7.4); only the amount formula changed.
- **Purchase page states no ratio.** Credit packages (Starter 5/$9.99 … Premium 100/$97.99) stand
  on their own. No credit-to-minutes ratio and no credit-to-USD rate is shown — both are gone from
  the model.
- **`credit_minutes_ratio` removed from `platform_settings`.** SPEC §4.7/§7.3/§7.4/§15/§16/§18
  amended in the same docs commit. *Not yet applied in code (flagged, not silently rewritten):* the
  seed still sets `credit_minutes_ratio` and prices its instant sample at `duration/3`
  (`src/db/seed.ts`), and `src/db/schema/identity.ts` carries a stale "instant derives from
  hourly/60" comment. These are pricing implementations outside the files scoped to this batch's
  code items — listed for a follow-up, left unchanged here.

## Phase 3 — student_subjects (subjects of interest)

- **New `student_subjects` join table for a student's subjects of interest (§7.1/§4.1).** SPEC §7.1
  has always listed "subjects of interest" in student onboarding, but §4 had nowhere to store it —
  a real gap surfaced when building onboarding. Resolved with the user: add a table mirroring
  `tutor_subjects` — `(student_id FK → profiles.id, subject_id FK → subjects.id)`, PK
  `(student_id, subject_id)`, index on `(student_id)`, **no `level`** (levels are tutor-only). RLS:
  owner reads/writes own rows only, **no public read**. Migration `drizzle/0009_student_subjects.sql`
  + SPEC §4.1/§5 amended in the **same commit** (CLAUDE.md).
- **FK to `subjects.id`, NOT a slug array (option 3 rejected — recorded so it isn't revisited).**
  Subject names are admin-editable and two were just renamed this build (#3 ESL, #11 Speaking Prep).
  A `text[]` of slugs carries no foreign key, so a future rename would silently **orphan** every
  stored interest pointing at the old slug. A real FK makes a rename a no-op for interests (the id is
  stable) and an `ON DELETE cascade` cleans up if a subject is ever removed. The extra join is a
  cheap price for referential integrity on admin-mutable data.

## Phase 3 — approval self-approval hole (security fix)

- **A tutor could self-approve; fixed with a trigger (`drizzle/0010`).** Extending `db:verify-rls`
  for the auth batch surfaced a real, exploitable hole in the Phase 1 RLS: the column-level
  `REVOKE UPDATE (approval_status, approval_note, approved_at) FROM authenticated` in `drizzle/0005`
  does **nothing**, because 0005 also runs `GRANT INSERT, UPDATE, DELETE ON ALL TABLES … TO
  authenticated`. **In PostgreSQL a table-level UPDATE privilege overrides a column-level REVOKE**,
  so any authenticated tutor could `UPDATE tutor_profiles SET approval_status='approved'` on their
  own row via a direct PostgREST call — bypassing admin review entirely. Verified: seeded pending
  tutor went pending → approved with no error.
- **Fix: `tutor_approval_guard` BEFORE UPDATE trigger, mirroring `profiles_guard`.** Raises if any
  approval column changes and `NOT public.is_admin()`. Chosen over re-granting column-by-column
  (brittle: every new column would need re-granting) — a trigger is robust and matches the existing
  role-immutability pattern. Admins change approval through their authenticated session (is_admin
  true); the future admin-approval action / any service write disables the trigger the way the seed
  does for `profiles_guard`. SPEC §5 amended in the same commit; `db:verify-rls` now asserts a tutor
  cannot change their own approval_status. *Why a trigger and not just fixing the app:* the app never
  set approval_status (onboarding leaves the column at its `pending` default), so this was never an
  app bug — it was reachable only by calling the database directly, which is exactly what RLS/DB
  guards exist to stop.

## Phase 3 — re-review on material change (product decision)

- **An approved tutor's edit goes live immediately; a MATERIAL edit flags for re-review.**
  Approval must not become a one-time gate — a tutor approved once could otherwise rewrite their
  headline, subjects and rate into something nobody vetted. But the opposite extreme is worse:
  blocking edits behind re-approval, or flipping `approval_status` back to `pending`, would **drop a
  working tutor out of search over a typo fix** and stop their bookings while an admin gets round to
  it. So the edit is live at once and the review happens **after the fact**.
- **Two timestamp columns, NOT a new `approval_status` value** (`drizzle/0011`):
  `profile_changed_at` / `profile_reviewed_at`. Needs re-review =
  `profile_changed_at is not null AND (profile_reviewed_at is null OR profile_reviewed_at < profile_changed_at)`.
  *Why not an enum value:* approval state ("is this person allowed to teach here") and change state
  ("has anyone looked at the current version") are **orthogonal**. Adding e.g. `approved_changed` to
  the enum makes every `approval_status = 'approved'` check in browse, guards, earnings and
  withdrawals silently wrong — Phase 8 pays out against approval state, and that is exactly where
  conflating the two would bite.
- **Material fields:** `headline`, `about`, subjects, `hourly_rate_credits`, `intro_video_url`.
  **Non-material:** avatar, `languages`, `education`, `years_experience`. Rationale: material fields
  are the ones a student's booking decision and the platform's pricing rest on.
- **The flag is set by a TRIGGER, not by application code.** Two reasons. (1) "A no-op save must not
  flag" becomes structurally true: the trigger compares `IS DISTINCT FROM` on old vs new, so
  re-saving identical values cannot flag, without the action having to diff anything. (2) It cannot
  be bypassed by writing to PostgREST directly. A non-admin also cannot **clear** the flag to dodge
  re-review — their value for `profile_changed_at` is overwritten with the old one before the change
  test runs. Subjects live in a child table, so `tutor_subjects_change_flag` stamps the parent.
  `profile_reviewed_at` is admin-only, folded into the existing `tutor_approval_guard` (drizzle/0010).
- **Pending tutors are never flagged** — they are already in the normal approval queue, so a material
  edit before first approval is not a separate event.

## Phase 3 — the admin write path, and two guard bugs it surfaced

- **Admin approval writes go through the trusted server-side connection, not the admin's session
  (`drizzle/0012`).** RLS on `tutor_profiles` is owner-only (`user_id = auth.uid()`), so an admin's
  own PostgREST session cannot touch another tutor's row; `audit_log` is service-role write. Meanwhile
  the `tutor_approval_guard` from `drizzle/0010` required `is_admin()` (an `auth.uid()` that is an
  admin). Net effect: the approval queue had **no legal write path at all**. Rather than widening RLS
  so admins can update arbitrary tutor rows over PostgREST, the guards now also accept the trusted
  server-side connection — which already owns the tables and bypasses RLS, and which the seed already
  worked around by disabling the triggers. Authorization for that path is SPEC §5 Layer 2: every
  admin action calls `requireRole('admin')` as its first statement and writes `audit_log`.
- **`is_trusted_server()` must not use `current_user` — a guard-disabling bug caught by
  `db:verify-rls`.** The first version compared `current_user`. The guards are **`SECURITY DEFINER`**,
  so inside them `current_user` is the function OWNER (`postgres`) for *every* caller, including an
  end user over PostgREST. That made the function return true universally and silently disabled the
  approval guard — re-opening the exact self-approval hole `drizzle/0010` had just closed. The fix
  uses **`session_user`** (which survives the definer switch; `authenticator` for PostgREST,
  `postgres` for our server connection) plus the `service_role` JWT claim, since PostgREST connects
  as `authenticator` for anon, authenticated **and** service_role alike. *Lesson worth keeping:*
  inside `SECURITY DEFINER`, `current_user` is the definer — never use it for authorization.
- **A student could create their own `tutor_profiles` row.** The original INSERT/UPDATE policies only
  checked ownership (`user_id = auth.uid()`) with no role test, so any authenticated student could
  insert a tutor profile for themselves. Not exploitable for visibility (it lands `pending`, and the
  route guards read `profiles.role`, not `tutor_profiles`), but "students cannot write
  `tutor_profiles`" should be true at the RLS layer rather than merely unreachable. Both policies now
  require `profiles.role = 'tutor'`. Found by writing the §2f assertion, not by reading the policy.
- **`db:verify-rls` assertions must be state-independent.** Two assertions "failed" only because an
  earlier buggy run had already written the exact value they were trying to write — a no-op UPDATE
  does not fire an `IS DISTINCT FROM` trigger. The approval-note assertion now writes a unique value
  per run. A guard test that passes or fails depending on leftover rows is worse than no test.

## Standing rule — `current_user` is meaningless inside `SECURITY DEFINER`

**Never write a trust or identity check against `current_user` in a `SECURITY DEFINER` function.
Use `session_user`, plus the `service_role` JWT claim when the service key must be recognised.**

This is a standing rule, not just an incident report. It cost us a silently disabled security guard
once already and the failure mode is invisible: the check does not error, it simply returns `true`
for everybody.

**Why.** `SECURITY DEFINER` makes a function execute with the privileges *of its owner*. Inside such
a function `current_user` is therefore the **function owner** — for us `postgres` — no matter who
actually called it. An end user hitting PostgREST with an anon key runs the guard as `postgres` from
`current_user`'s point of view. So:

```sql
-- WRONG. Returns true for every caller, including an anonymous one.
SELECT current_user IN ('postgres', 'service_role');
```

**What happened.** `is_trusted_server()` (drizzle/0012) was written that way and called from
`tutor_approval_guard`, itself `SECURITY DEFINER`. The guard became `... AND NOT is_trusted_server()`
= `... AND false`, i.e. it never fired — **re-opening the exact tutor self-approval hole that
`drizzle/0010` had been written days earlier to close**. Nothing errored. It was caught only because
`db:verify-rls` asserts the negative case ("a tutor cannot change their own `approval_status`") and
that assertion flipped from pass to fail.

**The correct form:**

```sql
-- RIGHT. session_user survives the definer switch; the JWT claim distinguishes
-- service_role, because PostgREST connects as `authenticator` for anon,
-- authenticated AND service_role alike.
SELECT session_user IN ('postgres', 'supabase_admin')
    OR coalesce(
         nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role',
         ''
       ) = 'service_role';
```

**Corollaries worth keeping:**

- `auth.uid()` / `auth.role()` are safe inside `SECURITY DEFINER` — they read the request JWT, not
  the executing role. `public.is_admin()` is fine for the same reason.
- A guard is only as good as its **negative** test. Every DB-level guard we add gets a
  `db:verify-rls` assertion that the forbidden thing is actually refused; a guard with only positive
  tests will pass forever after it stops guarding.
- Those assertions must be **state-independent** (write a unique value per run). Two of ours
  "passed" spuriously because a previous run had already written the value being tested and a no-op
  `UPDATE` never fires an `IS DISTINCT FROM` trigger.

## Browse page — ink shell + full-bleed layout (`feat/browse-page-ink-theme`)

Four colour/layout changes to the public browse page and shell, requested directly (visual parity
with the Bubble build), no schema or behaviour changes. Density (Phase 3) is untouched.

1. **`PublicHeader` → `ink-900`.** Wordmark and nav go white, active nav / wordmark accent go gold
   (7.22:1). "Log in" and "Sign up" deliberately avoid a purple fill on ink — even though §10.1
   allows purple as a *fill carrying white text*, doing that here would put a purple block directly
   against the ink-900 header background with no visual separation, which reads as low-contrast in
   practice. Two new `Button` variants, `ink` (gold fill, `ink-900` text) and `ink-ghost` (white
   text, `ink-800` hover), carry the header CTAs instead. Measured: white-on-ink 9.29:1,
   gold-on-ink 7.22:1, `ink-300` hover 4.69:1.

2. **`PublicFooter` → new `ink-1000` token (`#1C2733`).** No existing token was dark enough for
   "darker than the header, near-black." Added exactly one token to the ink ramp (`--color-ink-1000`
   in `src/app/globals.css`, documented in SPEC §10.1) rather than hardcoding a hex in the
   component — Phase 2's "no hardcoded hex outside the token file" acceptance criterion still holds.
   `ink-1000` is scoped to the public footer; it is not a second authenticated-shell surface (§10.1's
   "ONE ink surface" claim is about the app shell/cards and is unaffected). All footer text is white
   (15.14:1).

3. **Filters rail → `ink-900` panel on desktop only.** `TutorFilters` gained a `surface: "light" |
   "ink"` prop (default `"light"`) instead of being recoloured unconditionally, because the same
   component renders inside the mobile `Drawer`, which is a separate light-surface container — a
   global recolour would have made the mobile drawer's filter text white-on-white. Only the `/`
   desktop `<aside>` passes `surface="ink"`. Unchecked checkboxes get an `ink-300` border (4.69:1,
   invisible `border-gray-500` on ink otherwise). Checked checkboxes/switch use gold fill instead of
   purple, for the same adjacent-contrast reason as the header CTAs. The `Sort` `<select>` gets an
   explicit on-ink treatment (`ink-800` fill / `ink-700` border / white text) — the shared component
   defaults to a white trigger, which is legible but inconsistent with a "dark panel"; left
   unstyled it would not have failed contrast, but would have looked like a light chip floating in
   the dark rail.

4. **Browse page (`/`) → full-bleed, sidebar pinned left.** The page no longer wraps in
   `container-page` (1200px max-width); it's `w-full` with a small edge gutter (`px-4`/`px-6`) so
   the layout matches the Bubble build instead of centering with large white margins. Scoped to `/`
   only — SPEC §10.1 now says so explicitly, so a future reader doesn't "fix" the browse page back
   to the shared container.

Verified at 360px and 1440px. All four changes, the new token, and both SPEC edits (§10.1 token
table + prose, §10.1 spacing/container paragraph) landed in the same commit as this entry, per the
CLAUDE.md standing rule.

## Reversal — full-bleed is now the site-wide default, not a browse-only exception

Item 4 above (and the SPEC line it added) said the browse page's full-bleed layout was a one-off,
scoped to `/`, and that `container-page`'s 1200px max-width stayed the default everywhere else.
That constraint was **reversed** on the same branch, same PR (#7), before merge: every currently
built page is now full-bleed, matching `/`, not just the browse page.

**Why.** Once the browse page, header, and footer went full-bleed, every other page sat at 1200px
centered next to a full-bleed one — the boxed pages now look like the exception rather than the
rule, and the visual seam is worse than either being consistent. Site-wide full-bleed (with a small
edge gutter, not a hard max-width) is the intended layout, matching the Bubble build page-for-page,
not a browse-specific concession to the sidebar-pinned-left layout.

**What changed.** `container-page` was removed from every remaining page-*wrapper* use: `PublicHeader`,
`PublicFooter` (already full-bleed from item 1/2/4 above), `AppShell`'s content panel (drives
`/dashboard/favourites`, `/tutor/profile`, `/admin/tutors`), the `(auth)` layout header (drives
`/login`, `/signup`, `/forgot-password`, `/reset-password`), `/tutors/[slug]`, and
`/dev/kitchen-sink`. Each was replaced with `w-full` + the same `px-4 md:px-6` gutter already used
by the header/footer/browse body, not with no gutter at all. `/onboarding` needed no change — it
was never wrapped in `container-page`; its outer `min-h-screen bg-gray-50 px-4 py-12` was already
full-bleed with a centered form card inside, which is the pattern this reversal generalizes, not
one it conflicts with.

**What did NOT change.** `container-page` the `@utility` is untouched in `globals.css` — it's still
valid CSS, still used by `/suspended` (out of scope for this pass), and stays available for a future
page that genuinely wants a boxed reading-width. Component-internal max-widths are untouched:
`/tutor/profile`'s `mx-auto max-w-2xl` and `/onboarding`'s `mx-auto w-full max-w-xl` are a
form/card choosing its own width, not a page-level box, and SPEC §10.1 now says so explicitly so a
future reader doesn't try to "fix" those back to full width or `container-page` forward onto them.

SPEC §10.1's spacing/container paragraph was rewritten (not just amended) in the same commit as this
entry, per the CLAUDE.md standing rule.

## Phase 4 Part 1 — availability slot computation (`phase-4-part1-availability`)

Scope: the availability tables (already landed in Phase 1 migration `0000`, matching §4.2 exactly —
no new migration or columns needed this pass) and the **pure, DB-independent** slot computation
`src/lib/availability/compute-slots.ts`, with Vitest coverage per §15. Explicitly **out of scope**
(Part 2): booking creation, credit/ledger debit, pricing, and any UI. The design choices below were
not pinned by the existing spec; each is now reflected in SPEC §4.2's "Slot computation semantics"
block, per the CLAUDE.md standing rule.

- **A slot is a discrete candidate start on a fixed grid**, not a free interval. Bookable iff
  `[start, start + slot_duration)` fits entirely inside a tutor-local availability window. Candidate
  starts step from **each window's own start** by `slot_step`. *Why:* §7.3 has the student pick a
  slot *then* a duration from the fixed 30/60/90 menu; discrete starts are what the calendar renders
  and what the "no off-by-one" test in §15 is about. Duration and step are **function parameters**
  (defaults 60 / 30), not columns — the booking flow calls the function once per offered duration.
  *How to apply:* Part 2's server action calls `computeSlots` per duration; no schema change.
- **`now` is an explicit input**, not read from the clock inside the function. *Why:* purity and
  testability — the cutoff tests pin a fixed `now`. *How to apply:* callers pass `new Date()`.
- **Date range is read in the viewer's time zone; rules/exceptions expand per tutor-local date.**
  *Why:* §7.3 renders the student's own calendar, while §4.2 stores rules in the tutor's zone. The
  function scans tutor-local dates ±1 day around the range to cover a viewer-tz edge that lands
  mid-day in the tutor's zone, then filters by the UTC range window.
- **Exception semantics.** `is_available=false` blocks the whole tutor-local day (times ignored),
  overriding rules; `is_available=true` **with both times** is a partial-day override that *replaces*
  that day's rules (multiple such rows union); `is_available=true` with **null times is a no-op**
  (rules apply). *Why:* §4.2 only spelled out the full-day block; the partial-override and no-op
  cases needed pinning. The null-times "available" no-op avoids a meaningless "available but no
  window" state.
- **Overlap is half-open `[start, end)`.** Back-to-back bookings don't self-conflict and a slot
  abutting a booking's end is bookable. *Why:* prevents the off-by-one that would either leak a
  double-booked slot or drop a legitimately free one.
- **Cutoffs are both inclusive.** Slot bookable at exactly `now + min_booking_notice_minutes`; the
  horizon is a **rolling** `now + max_booking_days_ahead × 24h` (not a calendar-day boundary), slot
  bookable at exactly the horizon. *Why:* a single, memorable rule; rolling matches "how far ahead
  *from now*".
- **Time-zone math uses the runtime IANA/ICU database via `Intl`, not `@date-fns/tz`.** *Why:*
  CLAUDE.md forbids adding a dependency not in SPEC §2 without asking, and `Intl` is DST-correct out
  of the box on Node 22. *How to apply:* `zonedWallToUtc` measures the zone offset at the target
  instant and refines once across a transition; nonexistent spring-forward times resolve forward,
  ambiguous fall-back times resolve to the first occurrence — acceptable for availability windows.
- **Seeded `platform_settings` extracted to `src/db/platform-settings-defaults.ts`.** *Why:* §15
  says the notice/horizon tests must use the real seeded values (120 / 7), not a hardcoded guess.
  The seed and the DB-independent tests now import one pure constant set, so a retune can't silently
  drift a test. *How to apply:* `seed.ts` imports `PLATFORM_SETTINGS`; tests read via
  `seededSetting(key)`. Behaviour of the seed is unchanged.

Tests: `tests/unit/availability.test.ts` — DST spring-forward and fall-back (tutor `America/New_York`,
viewer `Africa/Lagos`), cross-tz rendering (viewer `Asia/Kolkata` +5:30), full-day block + partial
override against an active rule, back-to-back bookings with the abutting-slot leak check, and the two
cutoffs pinned to the seeded values. SPEC §4.2 was amended in the same commit as this entry.

## Phase 4 Part 2 — scheduled booking flow, credits only (`phase-4-part2-booking-flow`)

The first flow that debits real credit balances. Scope: the ledger, the booking-creation action,
both sides' booking list/detail pages, and the availability editor. Out of scope (unchanged): no
cancellation/refunds, no PayPal, no LessonSpace, no instant sessions. SPEC §7.3 gained a Part 2
implementation note in the same commit.

- **The ledger (`src/lib/credits/ledger.ts`) is the only writer to `wallets.credit_balance` and
  `credit_transactions`** (SPEC §7.10, CLAUDE.md). `debitWallet`/`creditWallet` take a small
  **`LedgerExecutor`** interface, not the Drizzle tx directly. *Why:* the pooler + CI have no live
  Postgres, so the money invariants (insufficient-balance rejection, correct `balance_after`,
  idempotency on a duplicate reference, no lost update under a serialized lock) had to be
  unit-testable against an in-memory executor. *How to apply:* `walletExecutor(tx)` is the
  production adapter and the single place issuing the wallet `UPDATE` + the `SELECT … FOR UPDATE`
  lock; the booking action calls `debitWallet(walletExecutor(tx), …)` inside `db.transaction`.
- **`InsufficientCreditsError` / `DuplicateLedgerReferenceError`** are typed so the action maps them
  to clean user messages; anything else rethrows.
- **`pgErrorCode(err)` unwraps Drizzle's `DrizzleQueryError.cause`.** *Why:* a live smoke test
  (below) revealed Drizzle wraps the driver error, so the real SQLSTATE is on `.cause`, not the
  top-level `.code`. Without unwrapping, the idempotency (`23505`) and overlap (`23P01`) catches
  would silently miss and surface a raw 500 instead of the intended message. Both the ledger and the
  booking action now go through `pgErrorCode`; a unit test locks the cause-walk.
- **Booking action order: insert booking, then debit, in ONE transaction.** *Why:* the
  `bookings_no_overlap` GiST exclusion rejects a slot won since re-validation before the wallet is
  touched; if the debit then fails (insufficient), the booking insert rolls back with it — no
  debited-but-no-booking and no booking-without-debit. The booking id (from `returning()`) is the
  ledger `reference_id`, so a retried create can't double-debit.
- **Server re-validates everything the client sends** (SPEC §5): price re-derived with
  `sessionPriceCredits`; slot re-validated with the same pure `computeSlots` via `isSlotOpen`; tutor
  must be approved and must teach the subject; can't book yourself. The client never sends a price.
- **Shared slot grid `SLOT_STEP_MINUTES = 30`** (`src/lib/availability/validate-slot.ts`) is used by
  both the server-rendered calendar and the re-validation, so a rendered slot is a recomputable
  slot. The public calendar precomputes one slot list per offered duration.
- **No wallet auto-creation on debit.** A debit against a missing wallet is *insufficient*, not an
  auto-open at zero; a credit into a missing wallet opens it at zero first (Phase 5 purchases).
- **Runtime writes go through the Drizzle `postgres` role (BYPASSRLS)** — the trusted server-side
  path, same as the admin write path (drizzle/0012). `wallets`/`credit_transactions` stay
  service-role-only for PostgREST; authorization for the booking path is Layer 2 guards
  (`requireRole('student')` + `requireVerifiedEmail`), never the client `userId`. `db:verify-rls`
  still passes unchanged.
- **Booking-list tabs are status-based** (SPEC §6): upcoming = `confirmed`/`in_progress`, past =
  `completed`, cancelled = the `cancelled_*`/`no_show_*`/`expired`/`pending_payment` set. Simpler and
  drift-free vs. a time cutoff; a confirmed-but-elapsed booking lingers in Upcoming until the Phase-4
  completion cron flips it (that cron is a later slice).
- **Availability editor does a whole-schedule replace in one transaction** — the editor submits the
  complete desired state, so delete-all-then-insert per tutor is simplest and atomic. Weekly rules
  are recurring per-weekday windows in the tutor's timezone; exceptions are `is_available=false`
  (day off, null times) or `is_available=true` + both times (custom hours). Confirmed weekly, not
  one-off slots.

**Live integration smoke (self-rolling-back).** Because this is the money path and the unit tests
use an in-memory executor, a throwaway script ran the real Drizzle transaction against dev Postgres
(session pooler) entirely inside transactions it then aborted — nothing persisted. It confirmed:
`SELECT … FOR UPDATE` debit + `balance_after`, the append-only ledger row, the `(type, reference_id)`
unique index → `DuplicateLedgerReferenceError` (`23505`), and `bookings_no_overlap` → `23P01`. This
is what surfaced the `.cause` wrapping bug above.

## Phase 5 Part 1 — PayPal orders, capture, webhook (`phase-5-part1-paypal`)

The first flow that takes real money, and `creditWallet`'s first production caller. Scope: the
PayPal client, the order/capture routes, the webhook, and credit-package lookup. Out of scope
(Part 2): `/dashboard/wallet`, booking direct-pay, `/admin/payments`. SPEC §7.6 gained a Part 1
implementation note in the same commit.

- **No PayPal SDK.** Three REST endpoints via `fetch` in `src/lib/paypal/client.ts`. *Why:* SPEC §2
  pins the dependency list and CLAUDE.md forbids unlisted deps; the SDK buys nothing here.
  *How to apply:* the two hosts live in one `HOSTS` map keyed by `PAYPAL_ENV`, and
  `paypalBaseUrl()` is the only place either appears — going live is an env change, never a code
  change. Anything other than `PAYPAL_ENV=live` resolves to **sandbox**, so a typo cannot silently
  point a dev build at real money. Credentials are read lazily inside the request path, so importing
  the module in a build or test that never calls PayPal needs no secrets.
- **Access token cached in module scope, keyed by `env:client_id`.** Refreshed 60s before PayPal's
  stated expiry, and `paypalFetch` retries once on a 401 with a fresh token. *Why:* a rotated key or
  a sandbox→live switch must never reuse the previous environment's token.
- **`payments` row is inserted *before* the PayPal order, with a `pending:<payment id>` placeholder
  in `provider_order_id`.** *Why:* the column is `NOT NULL UNIQUE` and PayPal's order id doesn't
  exist until the call returns, but the row must predate anything the buyer can approve — otherwise
  a capture or webhook could arrive for money we have no record of. *How to apply:* insert with the
  placeholder (no PayPal id can collide with a `pending:` prefix), create the order with
  `custom_id = payments.id`, then stamp the real order id. If order creation fails the row is marked
  `failed`, with the PayPal error body in `raw_payload` for `/admin/payments` (Part 2).
- **`PayPal-Request-Id` is set to our `payments.id` on create and to `capture:<orderId>` on capture.**
  *Why:* a retried create would otherwise open a *second* order the buyer could pay twice; PayPal's
  own idempotency replays the original response instead.
- **The client capture and the `PAYMENT.CAPTURE.COMPLETED` webhook are one code path**
  (`settleCapture`, `src/lib/paypal/settlement.ts`), called with the same `reference_type='payment'`
  / `reference_id = payments.id`. *Why:* the spec's requirement is that a webhook racing or
  following a client capture is a **no-op via the existing `(type, reference_id)` unique index**
  (§4.4), not a special case — so there is no second idempotency mechanism, no "was this already
  captured" flag, and no ordering assumption between the two. Whichever arrives first credits;
  the other gets `DuplicateLedgerReferenceError` and returns `already_credited`.
- **The ledger append runs inside a SAVEPOINT (a Drizzle nested transaction).** *Why:* in Postgres a
  unique violation **aborts the whole transaction** — every later statement raises `25P02`. Catching
  `DuplicateLedgerReferenceError` at the top level would therefore roll the `payments.status =
  captured` update back along with the rejected append, and the second capture path would silently
  undo the first one's bookkeeping. *How to apply:* `PaymentStore.savepoint()` wraps the append;
  `ROLLBACK TO SAVEPOINT` unwinds only it and leaves the outer transaction usable. The in-memory
  test ledger models the aborted-transaction state precisely so this is a real assertion, not a
  comment.
- **Settlement is storage-agnostic (`settlement.ts` pure, `fulfilment.ts` the Drizzle adapter)** —
  the same split as `LedgerExecutor` in Phase 4 Part 2, and for the same reason: the pooler + CI have
  no live Postgres, so "credits exactly once across a client/webhook race" has to be testable
  against an in-memory `PaymentStore`. The shipped function is the one under test, not a copy.
- **The payments row is taken `SELECT … FOR UPDATE` before anything else in settlement**, so a
  concurrent capture and webhook serialize on it instead of interleaving. It is matched by
  `provider_order_id` first, falling back to `provider_capture_id` — `PAYMENT.CAPTURE.REFUNDED`
  carries a *refund* resource, so `resource.id` is the refund id and the capture must come from
  `supplementary_data.related_ids`.
- **A late `COMPLETED` does not resurrect a refunded payment.** The status update is skipped when the
  row is already `refunded`; the credit stays guarded by the unique index regardless.
- **`DENIED` → `failed`, `REFUNDED` → `refunded`, and neither touches the wallet.** *Why:* a denied
  capture never credited, and clawing credits back on a refund is an **admin** action (§18 item 4 —
  no automatic refunds), not something a webhook does silently behind a student who may have already
  spent them. A refund that should reverse credits is `/admin/payments` work (Part 2).
- **Unverified webhook → 400 before any lookup or write; unset `PAYPAL_WEBHOOK_ID` → 503.** *Why:*
  the signature is the *only* authorization on that route (the caller is PayPal, not a session), and
  a forged `PAYMENT.CAPTURE.COMPLETED` mints free credits — so verification precedes everything. The
  503 is a deliberate split from the spec'd 400: a **misconfigured server** should have the delivery
  retried once configured, not permanently discarded, which a 4xx would cause. *How to apply:*
  `PAYPAL_WEBHOOK_ID` is still blank in `.env.local`; it is filled in after registering the webhook
  in the PayPal dashboard (RUNBOOK), and until then the route 503s every delivery.
- **Verified-but-unhandled events return 200**, including event types we don't handle and orders we
  have no record of. *Why:* both are final — a retry cannot change the outcome — and leaving PayPal
  to redeliver forever hides real failures.
- **The webhook handler is pure and dependency-injected** (`handlePayPalWebhook(rawBody, headers,
  deps)`); the route file is a ten-line adapter. *Why:* the whole decision table — reject unverified,
  credit only on COMPLETED, status-only on DENIED/REFUNDED — is then unit-testable without a running
  Next server, PayPal credentials, or Postgres. The raw body is read with `request.text()` and parsed
  here, because the signature covers those exact bytes.
- **New route-handler guards (`src/lib/auth/api-guards.ts`).** *Why:* the existing guards
  `redirect()`, which is right for a page but useless to a `fetch` caller — a 307 to /login is not
  something the client can act on. *How to apply:* `requireApiRole`/`requireApiUser` throw a typed
  `ApiAuthError` the route maps to a JSON status. Ownership on the capture route is checked against
  `payments.user_id` **before PayPal is called**, and a payment belonging to someone else 404s rather
  than 403s so the route can't be used to probe order ids.
- **Buying credits requires `role = 'student'` and a verified email.** *Why:* one account, one role
  (§18 item 13) — a tutor earns credits, never buys them — and credits are only spendable on
  bookings, which require a verified email (§7.1). Verifying *before* taking money beats leaving a
  paid-up student unable to book. Both are one-line reversals if the product decision changes.
- **`credit_packages` parsing drops malformed rows** (`parseCreditPackages`). *Why:* the key is
  admin-editable, and a half-saved row must never reach PayPal as a `$0` or `NaN` order. A dropped
  row means its id is unknown, which fails loud in the route; `getCreditPackages()` falls back to the
  seeded tiers only when *every* row is unusable.
- **Package ids are matched exactly** — no trimming, casing, or prefix matching — so `"starter "`
  is an error rather than a guess about which tier the buyer meant.
- **The client capture is a three-way branch on PayPal's returned capture status, not
  completed-or-not** (`settleCaptureOutcome`, `src/lib/paypal/capture.ts`). **COMPLETED** credits
  through `settleCapture`; a **terminal** decline (DECLINED / FAILED / any non-recoverable status)
  writes `payments.status = failed` and 409s; **PENDING** persists `provider_capture_id` and
  `raw_payload` only and **does not write `payments.status` at all**, returning 202. *Why:* the old
  code collapsed PENDING into `failed`, which is indistinguishable from a hard decline. A PENDING
  capture (e.g. under review) can still complete, and settlement intentionally permits
  `failed → captured` so a late `PAYMENT.CAPTURE.COMPLETED` still credits — but writing `failed`
  loses the distinction a retried capture needs, and makes a genuinely-declined row look identically
  recoverable. Leaving the status untouched on PENDING keeps the row recoverable by **either** the
  webhook or a retried capture, with no false `failed` in between. *How to apply:* PENDING goes
  through `recordPendingCapture` (`fulfilment.ts`), which locks the row and updates only the capture
  id + payload — never the status. `settlement.ts` is untouched: its `failed → captured` path stays
  as-is on purpose.
- **The capture decision is pure and dependency-injected** (`settleCaptureOutcome(orderId, order,
  deps)`), matching `handlePayPalWebhook`; the route file is the thin adapter that authenticates,
  loads the payment, calls PayPal, and wires the real deps. *Why:* same constraint as the webhook —
  the route imports `server-only` (transitively) and so cannot be imported by a unit test, so the
  three-way branch (and the 202-on-PENDING guarantee) is testable only as a pure core. The pure
  order-shape readers (`isOrderCompleted`, `isOrderPending`, `captureIdFrom`) moved from `orders.ts`
  into `capture.ts` for the same reason — `orders.ts` carries `server-only`.

**Not tested against live PayPal.** The unit tests cover package lookup, the client/webhook
double-capture race, signature rejection, and DENIED/REFUNDED; none of them talk to PayPal. Sandbox
end-to-end and the single real-card transaction remain RUNBOOK items (§15, and the §7.6 Port Harcourt
constraint), and `/admin/payments` — the view built specifically to debug that one transaction — is
Part 2.

**Live integration smoke (self-rolling-back) — Part 1.** As in Phase 4 Part 2, and for the same reason — this
is the money path and the unit tests use in-memory storage — a throwaway script ran the real
`settleCapture` / `markStatus` against dev Postgres (session pooler) inside a transaction it then
aborted; nothing persisted. It confirmed, against actual Postgres rather than a model: the
`SELECT … FOR UPDATE` on `payments`, `credited` → `already_credited` on a replay with **one** ledger
row and the balance moved once, `payments.status = captured` **surviving** the duplicate-key
rejection (the SAVEPOINT doing its job — this is the assertion the whole design turns on), a late
COMPLETED leaving a refunded row refunded, and the refund path not clawing credits back. The script
had to rebuild the `PaymentStore` adapter rather than import it: `server-only` is resolved by Next's
bundler and is not an installed package, so no `tsx` script can import a module that declares it —
which is also why every unit test here drives the pure `settlement.ts`/`webhook.ts` modules and not
the route files.

## Phase 5 Part 2 — wallet, booking direct-pay, admin payments (`phase-5-part2`)

Closes Phase 5: `/dashboard/wallet`, booking direct-pay, `/admin/payments`, plus one hardening fix
carried over from a production incident. SPEC §7.6's Part 1 note became a Part 1+2 note, and §4.2 /
§4.3 / §7.3 gained the pending-payment slot rule, in the commits with the code they describe.

- **`PayPalConfigError` is a 503 at the route-adapter boundary, never an uncaught 500.** A deploy
  missing `PAYPAL_CLIENT_ID` threw out of `verifySignature` and reached the caller as a 500 with a
  stack trace (production logs, 2026-08-22). *Why 503:* a missing credential is the **server's**
  fault and is retryable once set — identical reasoning to the unset-`PAYPAL_WEBHOOK_ID` 503 the
  webhook handler already returned. *How to apply:* `withPayPalConfigBoundary` wraps the handler
  body of all three PayPal routes; the response body is generic and the **missing variable's name
  goes to the server log only** — naming it in the response is an information leak. The pure
  handlers are untouched; this is adapter-level. `PayPalConfigError` moved to a `server-only`-free
  module (re-exported from `client.ts`, so every existing import still resolves) because the routes
  it protects cannot be imported by a test.
- **Wallet history is paginated, never loaded whole.** `credit_transactions` is append-only and
  unbounded, so `/dashboard/wallet` reads one `?page=` window ordered by the existing
  `(user_id, created_at desc)` index. The user id comes from the guard, never the URL — `?page=`
  selects a window of *that* user's ledger and nothing else.

### Direct-pay: a booking has no USD price of its own

The hard question in Part 2. §18 removed `credit_usd_rate` precisely because the five tiers span
$2.00→$0.98 per credit, so there is no credits→USD rate to price a booking with — yet PayPal needs
a USD amount. Reintroducing a conversion constant would have re-opened exactly what §18 closed.

- **Direct-pay is buy-then-spend in one checkout.** Credits are the unit of account and USD exists
  only where credits are **sold**. So the order mints exactly the credits the booking costs and
  immediately spends them: `purchase` credit (`reference_id = payments.id`), then `booking_debit`
  (`reference_id = bookings.id`), then `pending_payment → confirmed`, all in one transaction.
  *Why:* it needs no new pricing concept — direct-pay is just a credit purchase the student never
  gets to keep. **Net wallet effect is zero, which is correct** (they never held these credits), and
  `reconcile-wallets` still balances because both legs are real ledger rows rather than a special
  case that skips the ledger.
- **Both legs ride the existing `(type, reference_id)` unique index**, so the client/webhook race is
  a no-op on each independently — no new idempotency machinery, same mechanism as Part 1.
  *How to apply:* each leg runs in its own SAVEPOINT (a unique violation aborts the whole
  transaction otherwise). **The mint's duplicate is the signal that the whole settlement already
  ran** — both legs land together, so either both rows exist or neither does — and the spend is
  therefore **skipped** on a replay rather than retried. Retrying it would hit `applyDelta`'s
  balance check, which runs *before* the unique index, and raise `InsufficientCredits` against a
  wallet that is simply back to its pre-purchase balance, turning a benign replay into an error.
  The unit tests caught this; the first cut had it wrong.
- **Price basis: one flagged package, resolved by flag and nothing else.**
  `price_usd = ceil_to_cent(price_credits × basis.price_usd ÷ basis.credits)`. The basis is the
  `credit_packages` entry carrying `is_direct_pay_basis` — **never** array index, **never** a
  runtime median. *Why:* retuning direct-pay must be a **settings edit (move the flag) and never a
  code change, and never a new rate**; this is a real published package price used for one purpose,
  not a general credit→USD conversion, so `credit_usd_rate` stays removed. The flag sits on the
  middle tier, so **direct-pay is deliberately dearer per credit than the largest package** and
  buying credits keeps its volume incentive — the lever if that needs retuning is *which* package
  carries the flag.
- **`payments.credits_granted` now carries two meanings by `purpose`, and no migration was taken
  for it.** For `credit_purchase` it is unchanged: credits added to the wallet and kept. For
  `booking` (direct-pay) it is the amount minted and immediately debited in the same settlement
  transaction — net wallet effect zero, so it is **not** a balance the user holds. *Why no
  migration:* the column's existing type and semantics (an integer credit amount tied to this
  payment) already fit the direct-pay case exactly — reusing it is a documentation change, not a
  schema change, and splitting it into two columns would duplicate a value that is only ever read
  once, at settlement, and interpreted by `purpose` either way. SPEC §4.4 states both meanings
  explicitly rather than leaving the second one implicit in code.
- **Zero or two flagged packages throws** (`DirectPayBasisError`), with no fallback tier and no
  first-match-wins. *Why:* a mispriced charge on the money path must surface as an error, not as a
  wrong amount (§3.3, no silent failures). The route lets it propagate rather than 400ing, because
  it is a server misconfiguration, not bad input.
- **Rounding is up, in integer cents.** A fractional cent never rounds in the buyer's favour against
  the platform. Cents-first arithmetic is load-bearing, not fussiness: `30 × 39.99 × 100 ÷ 30` in
  floats lands on `3999.000000000001` and would ceil to **$40.00** instead of $39.99.
- **The price is re-derived from the tutor's *current* rate**, not from `bookings.price_credits`.
  That column is a snapshot; the current rate is what the student is being asked to pay. No client
  amount is read at any point — the client can only name a `bookingId`.
- **A booking belonging to someone else 404s**, identically to a missing booking, so the endpoint
  cannot be used to probe which booking ids exist — the same choice the capture route makes for
  `payments`.

### The 20-minute pending_payment hold

- **`pending_payment` was added to the `bookings_no_overlap` predicate** (migration `0013`). *Why:*
  §7.3 step 5 always said the constraint counts pending_payment as occupying; the Phase 1 constraint
  did not, because nothing created such a row until now. Without it two students can both reach
  checkout for one slot, both pay, and the second capture has nowhere to land — money taken for a
  session that cannot exist.
- **A pending_payment booking older than 20 minutes does not block, measured from its `created_at`.**
  *Why:* an abandoned checkout must not strand the tutor's calendar until a cron happens to run. The
  §12 expire-unpaid cron becomes **tidy-up, not correctness** — the same relationship `live_tutors`
  has with sweep-presence (§3.1): the derived read is authoritative and the sweep merely tidies.
- **The 20 minutes is deliberately NOT in the exclusion predicate.** An exclusion predicate must be
  `IMMUTABLE`, so it cannot reference `now()` — the rule is unexpressible in the index. *How to
  apply:* it lives in `computeSlots` on the read side, and the booking transaction **expires the
  stale holds its slot collides with before inserting** on the write side. Without that sweep the
  two sides disagree: the calendar would offer a slot the constraint then refuses, and the student
  would get "just booked" forever. This is why the cron is not load-bearing.
- **Fail-safe directions:** a booking row with no `status` blocks unconditionally (a Phase 4 caller
  that never heard of pending payments keeps its old meaning), and a `pending_payment` row with no
  `created_at` blocks, because the alternative is double-selling a slot someone may be paying for.

### A captured payment is always honoured (direct-pay settlement reorder)

The bug: when the §12 sweep moved a `pending_payment` booking to `expired` before its capture
arrived, `settleCapture` committed the mint **and** the debit, then `confirmBooking` matched zero
rows and no-opped. The student was charged, held no credits, held no booking, and the webhook
returned 200 so PayPal never retried. A real payment, silently lost.

- **The order is now mint → confirm → debit, and the debit is gated on the confirm.** Both legs stay
  in the same outer transaction; the confirm sits between them rather than after them. *Why:* the
  mint is the leg that turns money into something the student holds, so it must not depend on
  anything; the debit is the leg that takes it away again, so it must depend on the booking actually
  existing. Ordering them the other way round made the two legs a package deal whose success nobody
  checked.
- **If the booking cannot be confirmed, the debit is skipped entirely and the student keeps the
  credits.** *Why:* **this is the only outcome that requires no refund**, and SPEC has no refund path
  (§18 item 4) — a design we are not reopening for this. The student lost the slot, not the money,
  and can rebook immediately at the same price with credits already in hand. Every alternative
  (refund, admin queue, hold) invents machinery that does not exist and leaves the student worse off
  while it runs. *How to apply:* never add a leg that can strand captured money; if a downstream step
  can fail, the money-in leg goes first and unconditionally.
- **New result status `booking_unavailable_credits_retained`.** *Why:* this case previously returned
  `booking_already_confirmed`, which is a lie — that status means an idempotent replay of a
  settlement that did confirm. A status that names a lost booking as a success is how the bug stayed
  invisible. The webhook still returns 200 (a retry cannot conjure the slot back, and the money is
  accounted for), but the *status* now says what happened.

### The direct-pay replay guard reads the ledger instead of inferring from ordering

- **A replay now reads both legs — `purchase`/`payments.id` and `booking_debit`/`bookings.id` —
  before writing anything.** *Why:* the old shortcut was "a duplicate mint proves the whole
  settlement already ran", which was sound **only** because the debit unconditionally followed the
  mint. Gating the debit destroyed that premise: a committed mint may now legitimately stand with no
  debit beside it. The shortcut would have survived the reorder silently and misreported case (b) as
  case (a) forever. *How to apply:* when a guard's correctness rests on an ordering invariant, the
  invariant belongs in the comment beside it — and changing the ordering means re-deriving the
  guard, not re-testing it.
- **The `booking_debit` row is the record of whether the booking was confirmed.** It is written iff
  the confirm returned true, in the same transaction, so its presence is a fact rather than an
  inference. `PaymentStore.settledLegs` reads it; `/admin/payments` derives its flag the same way,
  which is why that flag stays correct however the booking row is edited later.
- **A retained mint is never debited retroactively**, even if a later replay finds the booking
  somehow confirmable again. *Why:* the money question was settled when the capture was honoured and
  the student was told the credits are theirs. Reopening it later takes credits back from someone
  who was told they had them.
- **The unique index is still the guard of record, not the read.** A client/webhook race is two
  separate transactions, so the loser's probe can predate the winner's commit; the duplicate
  rejection absorbs it, the guard re-reads, and both report the same outcome. The probe is an
  optimisation and a *disambiguator*, never the safety mechanism.

### The retained mint explains itself at read time, because §4.4 is absolute

The retained mint lands on `/dashboard/wallet` carrying a **positive** balance the student really
holds. Left reading "Credit purchase — 20 credits" it looks like a session they bought and cannot
find, so it has to say why they were credited and that the credits are theirs.

- **Rejected: amending the row's `description` after the confirm fails.** The first implementation
  did exactly this, through a narrow UPDATE on `credit_transactions` (`describeTransaction`), argued
  as "append-only is about the money — no delta moves, only the sentence a human reads". *Why
  rejected:* that argument is fine on its own terms and still wrong, because the constraint's value
  is not per-row — it is that it holds **without exception**. An append-only table with one narrow
  UPDATE path is a table where every future reader, auditor and reconciliation job has to establish
  which rows were rewritten and which weren't. That question is precisely the one an audit trail
  exists to foreclose, and no single row's wording is worth reopening it. *How to apply:* when a
  constraint's worth comes from being absolute, "this exception is tiny" is an argument **for**
  refusing it, not against — the tiny ones are the only kind anyone ever proposes.
- **The mint is inserted once, with the ordinary purchase wording, and never touched again.** The
  retained-credit label is derived on every read: `type = 'purchase'`, its `payments` row has
  `purpose = 'booking'`, and no `booking_debit` exists for that payment's `booking_id`.
- **The derivation is pure, in `lib/credits/retained-credits.ts`;** `db/queries/wallet.ts` supplies
  two page-scoped reads (payments by primary key, `booking_debit` by the `(type, reference_id)`
  unique index), both skipped when a page holds no `purchase` rows. *Why:* the same pure-core /
  thin-adapter split the ledger and settlement use, so the three cases that matter — retained mint,
  ordinary credit purchase, completed direct-pay — are unit-tested without a live Postgres.
- **It reuses the fact `/admin/payments` already derives**, the missing `booking_debit`, so the
  student's wallet and the admin's reconciliation view cannot disagree about whether credits were
  retained. Neither reads a stored flag; there is none to drift.
- **`LedgerExecutor` exposes no UPDATE-shaped method at all**, so there is nothing for a future
  caller to reach for. The in-memory ledger freezes appended rows and keeps a `setDescription`
  tripwire that throws, so reintroducing a write path fails loudly in tests rather than passing
  quietly.

### `/admin/payments` — read-only in this pass

- **Look up by PayPal order id OR capture id**, and show everything: the `payments` row, the linked
  `credit_transactions`, the linked booking when `purpose = 'booking'`, and `raw_payload` rendered
  readably. *Why:* this is the view that debugs the one live transaction that cannot be run from
  Port Harcourt (§7.6), so it favours showing everything over showing it prettily.
- **A captured direct-pay with no `booking_debit` is flagged *credits retained*** — a banner, a
  badge, and a note on the ledger table. *Why:* this state is expected, not an error, but it is
  indistinguishable at a glance from a half-finished settlement. An admin should not have to infer
  it from a captured payment sitting beside an unconfirmed booking, or from mismatched timestamps.
  The banner also states outright that **no refund is owed**, so nobody helpfully issues one.
- **The refund-reverses-credits action is deliberately NOT built.** §18 item 4 records reversing
  credits as an **admin** action, and it needs its own design pass (partial refunds, a student who
  has already spent the credits, and the `wallets.credit_balance >= 0` check all interact). Noted as
  deferred in PROGRESS rather than half-built.

**Acceptance is SANDBOX ONLY.** Real-card testing stays deferred to Phase 10, along with the live
webhook registration (RUNBOOK) — the sandbox webhook id does not work in live.

## Phase 6 — pre-build decisions (2026-08-22)

Five open questions blocking Phase 6 were settled by inspecting the live Bubble app directly
(rather than by inference from the earlier, partly-guessed Phase 1 / §18 decisions). This is a
**docs + one settings-default commit** — no migration. Where a decision requires a schema change,
it is scoped to the pending Phase 6 Part 1 migration `0014` and explicitly not written here. SPEC
§4.3, §4.7, §7.4, §7.5, and §18 item 1 were updated in the same commit (per the CLAUDE.md standing
rule).

- **Session durations become 30 / 60 / 90 / 120, not 30 / 60 / 90.** The live app offers all four
  durations on both the instant popup and the scheduled booking popup. The three-value menu carried
  from §18 would have silently dropped the 120-minute option at cutover — a live-inspection finding,
  not a product change. `session_durations` in `src/db/platform-settings-defaults.ts` updated to
  `[30, 60, 90, 120]`; `tests/unit/pricing.test.ts` extended to cover the fourth value. SPEC §18 item
  1 and §4.7 amended. *No migration* — `session_durations` is a `platform_settings` value, not schema.
- **`session_requests` gains `duration_minutes` and `price_credits`, pending migration `0014`.** The
  student picks a duration when sending an instant request; the server computes price at insert via
  `sessionPriceCredits()` and pins it on the request row, so the accept transaction charges exactly
  what the student was quoted regardless of any `hourly_rate_credits` change in between. Both columns
  integer, `not null`, server-authored — never taken from the client. SPEC §4.3, §7.4 amended now;
  schema change deferred to `0014`.
- **`session_request_status` gains `failed_payment`, pending migration `0014`.** The debit runs
  inside the tutor's accept transaction. If the student's balance moved between request and accept,
  the whole accept rolls back and the request goes terminal as `failed_payment` — not `expired`, not
  `declined` — because an operator reading `session_requests` must be able to tell a refusal from a
  payment failure. SPEC §4.3, §7.4 amended now; enum change deferred to `0014`.
- **`min_instant_credits` and `max_instant_minutes` are confirmed dead and scheduled for real
  deletion in migration `0014`.** Neither exists in the Bubble app; both were artifacts of the
  abandoned authorization-hold model (Phase 1 decision, "Instant-session hold via the ledger",
  above). The `platform_settings` *keys* were already removed by the §18 resolution, but §7.4's
  validation line still read "student has >= min_instant_credits" — a stale leftover now replaced
  with "student's balance >= price_credits for the chosen duration" (§7.4). Also marked for removal
  in `0014`: `tutor_profiles.instant_rate_credits_per_minute` (column) and `instant_hold` /
  `instant_release` / `instant_capture` (`credit_transaction_type` enum values) — both previously
  "retained but unused" per the Phase 1 and §18 entries above, now confirmed as safe to actually drop
  since the live app has no trace of a hold model. SPEC §4.1, §4.4, §4.7, §7.4 amended to mark
  pending removal; the migration itself is not written in this commit.
- **Scheduled-booking collision blocks at accept only, with no buffer.** The accept transaction
  rejects if the tutor has a `confirmed` or `in_progress` **scheduled** booking starting before
  `now() + duration_minutes`. This is an application-level guarded read inside the transaction, **not
  a constraint** — `bookings_no_overlap` (§4.3) deliberately excludes instant bookings, which have no
  time range. *Why no buffer:* Bubble has no such check at all, so inventing a gap would be adding a
  rule that doesn't exist upstream. The go-live toggle stays unrestricted. SPEC §7.4 amended.

**Also recorded from the same inspection:**

- **Ending an instant session is unchanged from Bubble and from §18: no refunds on early exit,
  hard stop at the booked duration, no grace period.** Credits are charged upfront regardless of how
  much of the session is actually used. Bubble's mid-session "buy more credits" top-up popup is **not
  ported** — under flat upfront billing there is nothing to run out of mid-session for that popup to
  attach to. SPEC §7.4 now states this explicitly rather than leaving it implied.
- **End-session does NOT clear `is_live`.** A tutor finishing a session is usually still available;
  clearing `is_live` on session end would drop them off the live list silently. Presence is owned by
  the heartbeat and the staleness sweep cron (§7.5), never by session lifecycle. Recorded as an
  explicit non-behaviour in SPEC §7.5 because it's the kind of omission a later reader assumes is a
  missing step rather than a deliberate boundary.
- **Correction: the Bubble countdown ran on a 180-SECOND interval, not 180 milliseconds.** The
  Phase-agnostic §18 resolution entry above (and the SPEC §7.4 text it produced) stated the interval
  as 180 ms, implying a units bug that would end a 60-minute session in ~4 seconds. Direct inspection
  of the live app shows the interval is 180 **seconds**, decrementing one credit per tick — i.e. the
  withdrawn "1 credit = 3 minutes" rule working exactly as designed, not a bug. This does not change
  any built behaviour: elapsed time was already computed server-side from `started_at` and the
  countdown was never going to be ported either way. The §18 entry above is left uncorrected
  (append-only); SPEC §7.4 and PROGRESS.md's "Notes / non-bugs" section carry the corrected figure.
- **Carry-forward: Bubble's flat duration÷3 pricing vs. the rebuild's per-tutor `hourly_rate_credits`
  pricing needs a Phase 10 data migration and cutover comms.** Every existing tutor needs a rate set
  before cutover, and every existing student will see prices change from the one flat platform rate
  they're used to. Recorded in PROGRESS.md "Still open" rather than actioned here — it's a Phase 10
  concern, not a Phase 6 blocker.

---

## Phase 6 Part 1 — presence + migration 0014 (2026-08-22)

Scope was presence and the schema cleanup only. Session requests, Realtime, billing and the session
room are Parts 2 and 3 and are deliberately absent — where a Part 1 file would otherwise have had a
half-implemented hook into them, it carries a `TODO(Phase 6 Part 2 / Part 3)` instead.

- **The sweep derives its work set from the `live_tutors` view, not from a threshold of its own.**
  `sweepStalePresence()` clears `is_live` where `is_live = true AND NOT EXISTS (SELECT 1 FROM
  live_tutors WHERE user_id = …)`. *Why:* §3.1 says the view is the single definition of stale, and
  SPEC §7.5 previously described the sweep as `last_seen_at < now() - presence_stale_seconds` — a
  setting that has not existed since Phase 1 (Decision #8 deleted it). Had that line been
  implemented literally, the 2-minute interval would have existed in two places that could be
  retuned independently, which is exactly the drift §3.1 forecloses. Deriving from the view means
  there is **no copy of the threshold anywhere in the write path**. SPEC §7.5 and §12 amended to
  match what was built. *Consequence accepted:* the view also requires `approval_status =
  'approved'`, so a tutor whose approval is revoked while live is swept offline as well. That is the
  right outcome — an unapproved tutor must not be advertised as live — and the go-live action
  refuses unapproved tutors anyway, so it is a backstop rather than a routine path.

- **Scheduling is Supabase `pg_cron` + `pg_net`, and there is no `vercel.json`.** *Why:* the deploy
  target is Vercel **Hobby**, whose cron jobs run **at most once a day**. A once-daily presence
  sweep is worthless against a 2-minute staleness window — it would leave `is_live` wrong on the
  base table for hours. `pg_cron` runs inside the same Postgres project as the data and honours
  `*/5`, and calls the route over `pg_net` with the bearer header, so the handler stays an ordinary
  HTTP route with nothing Vercel-specific in it. The setup SQL is a **documented snippet**
  (`drizzle/snippets/pg_cron_sweep_presence.sql`), not a numbered migration: `CREATE EXTENSION
  pg_cron` needs privileges the migration connection does not reliably have — a failure there would
  block every later migration — and the job embeds a per-environment secret that must not be
  committed. Secrets go in Supabase Vault rather than inline in `cron.job.command`, which is
  readable by anyone who can read the catalog. SPEC §3.5 and §12 amended. RUNBOOK carries the steps.

- **Nothing clears presence on page unload — there is no `pagehide` / `sendBeacon` handler.** The
  heartbeat does one thing: bump `last_seen_at`. It never writes `is_live` in either direction.
  `is_live = false` is written by exactly one path, the tutor's own deliberate toggle-off. *Why not
  a beacon:* see the same-PR revision at the end of this section — an earlier revision had one, and
  it was removed before merge.

- **The heartbeat route reads nothing from the request body.** `requireApiUser()` is the first
  statement and the user id comes from the session, so there is no id to spoof; with the beacon gone
  there is no event kind to send either, and the route ignores any payload entirely.

- **Going live is unrestricted by the tutor's calendar, but not by their approval.** The action
  refuses unapproved, suspended, wrong-role and unverified-email callers (`requireRole('tutor')` +
  `requireVerifiedEmail()`, re-checked independently of the layout), and does **not** consult
  `bookings` at all. *Why:* the scheduled/instant collision is enforced at **accept** (Part 2, §7.4)
  where the conflict actually exists; blocking here would drop a tutor off the live list for a
  booking that may never collide, and Bubble has no such check anywhere.

- **`/tutor` got a real page.** It had none — `homeFor.tutor` pointed at a route that 404'd in
  production (PROGRESS.md). The go-live toggle has to live somewhere, so Part 1 gives `/tutor` a
  deliberately thin overview: the toggle and nothing else. Earnings, upcoming sessions and the
  request inbox belong to later phases; a placeholder dashboard would be scope this phase was not
  asked for.

- **`PRESENCE_STALE_SECONDS` is a mirror of the view, and a test proves it.** `lib/presence/staleness.ts`
  exists only so the boundary can be unit-tested DB-free (§15) and so a "last seen" treatment can be
  rendered without a round trip — the write path never reads it. Because a constant that merely
  *claims* to mirror the view becomes a second definition the moment someone retunes the view,
  `tests/unit/presence-staleness.test.ts` parses the `interval '2 minutes'` literal straight out of
  `drizzle/0014` and asserts it equals the constant. The boundary itself is strict: the view's
  predicate is `>`, so a heartbeat **exactly** 2 minutes old is already stale.

- **The cron route answers to GET and POST.** SPEC §12 and the Vercel-cron convention make it a GET;
  `pg_net`'s documented call is `net.http_post`. Rather than pick one and leave the other silently
  405ing, both verbs run the identical guarded, idempotent sweep. It also **fails closed with 503
  when `CRON_SECRET` is unset** — an unset secret must never degrade into "no auth required" on an
  environment that is missing the variable.

### What had to be hand-written in migration `0014`

`drizzle-kit generate` produced four usable ALTERs. Three things it could not express:

- **The `credit_transaction_type` value removal.** Postgres has no `ALTER TYPE ... DROP VALUE`.
  drizzle-kit's generated form casts the column to `text`, `DROP TYPE`s, and casts back — which
  leaves the column unconstrained mid-migration and fails opaquely if any other object still depends
  on the type. Replaced with the rename-create-alter-drop dance, under which the column is never
  without an enum constraint and the final `DROP TYPE` fails loudly on any dependency we did not
  know about.
- **The `live_tutors` dependency.** The view (drizzle/0004) enumerates
  `instant_rate_credits_per_minute` by name, so the generated bare `DROP COLUMN` errors with "cannot
  drop column … other objects depend on it". The view is dropped and recreated around the drop —
  verbatim apart from the removed column, same explicit column list, same `security_invoker`, same
  predicate, same grants.
- **Two pre-flight guards.** `DO` blocks that abort with a readable message if `session_requests`
  is non-empty (the new columns are `NOT NULL` with **no default** — both are server-authored, and a
  default would paper over a caller that forgot to compute them) or if any `credit_transactions` row
  still uses one of the three values being removed. Both were verified empty against the live
  project before the migration was written; the guards make that a permanent property of the file
  rather than a fact about one afternoon.

### Same-PR revision — the `sendBeacon` presence-clear was removed before merge

An earlier revision of this PR sent `navigator.sendBeacon` on `pagehide` with `{ event: 'exit' }`,
and the heartbeat route cleared the departing tutor's `is_live` on receipt — SPEC §7.5's third
staleness defence, implemented literally. **Removed before merge.**

*Why.* `pagehide` fires on a full-page **reload** exactly as it fires on a real exit, and nothing in
the event distinguishes them. So a tutor who pressed F5 on `/tutor` while live was silently taken
off the live list, came back to a page whose toggle still read "live", and had no way to know they
had stopped receiving requests. That is a worse failure than the one the beacon was defending
against: it is silent, it is self-inflicted by an ordinary user action, and it makes the toggle lie.

*Why removing it is safe, not a regression.* §3.1 is the whole argument: **no student-facing read
ever consults `is_live` alone.** Every read goes through `live_tutors`, which filters on
`last_seen_at` at request time, so an ungraceful exit — killed process, closed laptop, dropped
connection, or a clean close — is answered correctly by the view whether or not any signal was sent
on the way out. The beacon was never load-bearing; it only shortened the window in which the
underlying row was untidy, which is precisely what the sweep cron is for and precisely what §3.1
says correctness must not depend on. Deleting it removes a false positive and costs nothing that
a student can observe.

*What was deleted rather than left as a no-op.* With the presence-clear gone the beacon had no
remaining job. The one other thing it could have sent — a final heartbeat on the way out — is
actively wrong: it would refresh `last_seen_at` at the exact moment the tutor left, extending their
liveness by the full staleness window instead of ending it. So the `pagehide`
listener, the `sendBeacon` call and its keepalive-fetch fallback, the `{ event }` body contract on
`POST /api/presence/heartbeat`, and `clearTutorLiveOnExit()` in the query layer were all removed
outright. A no-op beacon left in place would have read as a working defence to the next person.

*What still clears `is_live` immediately:* the tutor's deliberate toggle-off, and nothing else.
SPEC §7.5's "Going live" paragraph previously also promised "or navigating away cleanly"; that
clause is now gone from the spec, because with the beacon removed nothing implements it and Next.js
client-side navigation never fired `pagehide` in the first place. Leaving `/tutor` — by link, by
tab close, or by pulling the plug — now stops the heartbeat and lets the view age the tutor out.
SPEC §7.5 records the removal in place of the third defence so a later reader does not restore it as
an oversight.

## Phase 6 Part 2 — session-request handshake + billing (`phase-6-part2-session-requests`, 2026-08-23)

Scope was the handshake and the money: the two Realtime directions, the three Server Actions, the
accept transaction, and the expiry cron. **The room is not in scope** — `/session/[bookingId]`, the
Agora client, `/api/agora/token`, end-session, `complete-sessions` and `tutor_earnings` are Part 3,
and where Part 2 code would reach into them it carries a `TODO(Phase 6 Part 3)` rather than a
half-implementation. **No migration**: `0014` (Part 1) already shipped every column, enum value,
index, RLS policy and Realtime publication entry this phase writes to.

- **The scheduled-collision read gained an end-side condition the spec did not state, and the spec
  was amended rather than the code contorted.** SPEC §7.4 said the accept "rejects if the tutor has a
  `confirmed` or `in_progress` scheduled booking **starting before** `now() + duration_minutes`" —
  the start-side half of an overlap test, with no lower bound. Implemented literally, **every past
  booking blocks forever**: nothing sets `completed` yet (the complete-sessions cron is Part 3), so a
  tutor's first ever scheduled booking would permanently disqualify them from instant sessions, and
  the failure would look like the collision rule working. The guarded read is therefore a real
  overlap — `scheduled_start_at < now() + duration_minutes AND scheduled_end_at > now()` — and §7.4
  now says so. *Why amend rather than ask:* the two readings are not a product question with two
  defensible answers; one of them makes the feature unusable on the first booking, and the rule's own
  stated purpose ("the tutor is busy then") is only expressed by the other. **No buffer** either
  side, per the pre-build decision: back-to-back is allowed and a booking starting exactly as the
  instant session ends does not collide. `tests/unit/session-request-accept.test.ts` pins all four
  boundary cases.

- **The accept transaction's decisions live in a store-agnostic module; the SQL is an adapter.**
  `lib/session-requests/accept.ts` drives an `AcceptStore`/`AcceptTx` interface exactly as
  `lib/paypal/settlement.ts` drives a `PaymentStore`, with `db/queries/session-requests.ts` as the
  Drizzle adapter. *Why:* the four ways an accept must **not** charge a student — expired,
  no-longer-pending, calendar collision, balance moved — are the whole risk surface of this phase,
  and the pooler and CI have no live Postgres to test them against (Phase 4 Part 2 decision). The
  alternative, a single action wrapping `db.transaction`, would have left every one of them
  verifiable only by hand against the shared project.

- **`AcceptStore` owns `transaction()` rather than the function receiving an open one — because of
  the `failed_payment` write.** SPEC §4.3 requires that a debit failure roll back the entire accept
  **and** that the request end up terminal as `failed_payment`. Those two requirements point in
  opposite directions: a status write inside the transaction is rolled back with everything else,
  leaving the row looking untouched. So the module opens the transaction itself, catches
  `InsufficientCreditsError` after it has rolled back, and then issues `markFailedPayment` as a
  separate statement — conditional on the row still being `pending`, so it can never stomp a state
  something else reached meanwhile. A test asserts the ledger, the wallet and the bookings list are
  all untouched while the status is `failed_payment` and is neither `expired` nor `declined`.

- **The booking id is generated in application code (`crypto.randomUUID()`), not by the database.**
  `agora_channel` is `session_{booking_id}` (§4.3), which a single INSERT cannot express about its
  own generated id. The alternatives were an INSERT … RETURNING followed by an UPDATE — two
  statements and a window in which a booking exists with a null channel — or a generated column,
  which is schema for a formatting rule. Generating the id first makes the channel known before the
  row exists, so one statement writes a complete booking, and it lets the pure module compute and
  return the channel rather than reading it back.

- **An accept past the deadline moves the row to `expired` there and then.** SPEC §7.4 only requires
  the accept to *fail*. Leaving the row `pending` for the cron would be leaving a lie in the table
  for up to a minute — it is expired by the only clock that counts — and, more usefully, the student's
  waiting modal is driven by Realtime UPDATEs on that row, so writing the true status immediately is
  what lets them stop waiting now instead of at the next cron pass.

- **A student's own stale `pending` row never blocks them, cron or no cron.** The "at most one
  pending request" rule reads only rows with `expires_at > now()`, and the write path expires the
  student's stale rows before checking. This is the same shape as `createScheduledBooking` expiring
  the stale `pending_payment` holds it collides with (§7.3 step 5), and it is what keeps
  `expire-requests` **tidy-up rather than correctness** — the claim §12 now makes explicitly. Without
  it, a student whose tutor never answered would be locked out for up to a minute by a row everyone
  agrees is dead.

- **The swept tutor's requests expire immediately, and NOT in the sweep's transaction.** §7.4 says a
  tutor going stale expires their pending requests; the sweep does that in a second statement rather
  than one transaction with the presence update. *Why that is not a gap:* if the second statement
  failed, those requests would still be expired by `expire-requests` within a minute of their own
  deadline. The two sweeps are **independently self-healing**, which is worth more here than joint
  atomicity — and joint atomicity would make a failure in the request half roll back the presence
  half, which is the more visible of the two.

- **`expires_at` is computed by Postgres, not by Node.** `now() + make_interval(secs => ttl)` in the
  INSERT. The deadline is compared against `now()` by every later read and by both crons, so writing
  it from the app server would make expiry depend on two clocks agreeing. The TTL itself is
  `instant_request_ttl_seconds` from `platform_settings` (seeded 60, §4.7) rather than a literal —
  coerced to a positive integer and defaulted to the seeded value, because a settings row edited to
  `0` or `"60"` must not be able to mint a request that is born expired.

- **The countdown ring's `setInterval` is not the polling CLAUDE.md forbids.** The rule ("no
  `setInterval` polling anywhere except the presence heartbeat") is about asking the server for state
  on a timer. Both rings tick a deadline the client already holds and make **no network call**; every
  actual state change on those screens arrives over Realtime. Recorded because the rule reads
  absolute, and the next person will otherwise either delete a ring the spec asks for (§7.4, §10.2's
  ProgressRing exists for exactly this) or quietly widen the rule to cover something it never meant.
  SPEC §8 now says the same thing where the rule is stated.

- **Realtime payloads are notifications, not data.** The tutor's modal gets a row id from the INSERT
  event and then reads the student's name, the subject, the note and the price back through a guarded
  Server Action scoped to `tutor_id`. *Why not just render the payload:* the payload carries ids, not
  display names, so rendering it would mean joining `profiles` and `subjects` in the browser — and
  the browser is not where an authorization boundary belongs. Status transitions are the one thing
  read straight off the payload, because a status is not a join and the row is already RLS-scoped to
  the viewer.

- **The tutor's subscription is mounted in the `(tutor)` layout, under the relaxed approval guard.**
  §8 puts it in the tutor authenticated layout, which is also the layout that deliberately does
  **not** enforce approval (or `/tutor/pending-approval` would redirect-loop). That is safe rather
  than an oversight: only tutors the `live_tutors` view returns can be sent a request at all, and the
  view requires `approval_status = 'approved'`, so an unapproved tutor's subscription simply never
  fires. Mounting it on `/tutor` instead would have meant a tutor sitting on their availability
  editor never saw a request arrive.

- **The cron bearer guard was lifted out of the handler into `lib/auth/api-guards.ts`.** Part 1
  inlined it in `sweep-presence`; Part 2 made it the second handler needing exactly it, so it became
  `cronAuthFailure(request, job)` and both call it. *Why not copy it, as the phase prompt suggested:*
  it is a security check with a **fail-closed** branch (unset `CRON_SECRET` → 503, never "no auth
  required"), and two copies of a fail-closed branch are two things to keep in step — the one that
  drifts is the one nobody opens again. Behaviour is unchanged and the log prefix still names the job.

- **`/api/cron/expire-requests` answers to GET and POST**, for the same reason `sweep-presence` does:
  §12 and the Vercel-cron convention make it a GET, `pg_net`'s documented call is `net.http_post`,
  and leaving either verb silently 405-ing would be a trap. Its pg_cron snippet
  (`drizzle/snippets/pg_cron_expire_requests.sql`) deliberately **omits** the extension and Vault
  steps and points at the sweep-presence snippet for them: `vault.create_secret` raises on a
  duplicate name, so a self-contained copy would fail on every environment that is already set up
  correctly.

- **A student's request note becomes the booking's `student_notes`.** `session_requests.message` is
  "what I want help with" and `bookings.student_notes` is the same field one row later (§4.3), so the
  accept carries it across rather than dropping it — otherwise the tutor's context vanishes the
  moment they accept.

- **The `/tutors/[slug]` "Request now" button became its own white card rather than a control on the
  ink price card.** The Part 1 placeholder was a disabled button on the ink surface; the real widget
  is a duration picker, a subject select, a note field and an affordability warning, none of which
  have ink-surface treatments (§10.1 keeps purple off ink). It sits beside "Book a session" as
  "Start now", which also makes the instant/scheduled pair read as two ways to buy the same thing.

### Not built, deliberately

- **No cancel-my-request action for the student.** The `cancelled` status exists in the enum and the
  waiting modal renders a message for it, but nothing writes it in Part 2. §7.4 does not ask for one,
  and the request dies on its own in 60 seconds — a cancel button would be a second write path into a
  terminal state for a window that short. The modal handles the status because Realtime can deliver
  it (an admin, or a later phase, could set it), not because Part 2 produces it.
- **No tutor request inbox page.** Requests arrive as a modal wherever the tutor is; a list view of
  60-second-lived rows would be stale by the time it rendered. `/tutor` stays the thin overview Part 1
  made it.

## Test Supabase project — targeting and the safety guard (2026-08-23)

Infrastructure, not product. Merged as PR #18 (scaffold) and PR #19 (wiring).

- **A disposable project exists, and it is not a prod stand-in.** `nowtutors-test`, ref
  `uietkphpfqaicbndunwt` (eu-west-3), credentials in gitignored `.env.test`. It exists so seeding and
  E2E stop having to choose between writing to the project that serves production and not running at
  all. Nothing deploys against it and it holds no data anyone should care about losing.

- **Targeting is dedicated script variants, not a flag on the existing scripts.** Every db script has
  a `:test` twin that loads `.env.test`; `drizzle-kit` variants pass
  `--config=drizzle.config.test.ts`, and `tsx` variants require an explicit `--env=dev|test`
  argument supplied by the pnpm script itself. *Why this shape:* the requirement was symmetric — a
  normal `pnpm db:migrate` must not be able to reach test, **and** a test-targeted command must not
  be able to reach dev. An env var like `DB_TARGET=test` fails the second half: it persists in a
  shell, so the next unprefixed command in the same terminal silently inherits it. Two names that
  each carry their own destination cannot be confused by leftover state. The `--env` argument is
  **required, not defaulted** — running `tsx src/db/reset.ts` directly throws rather than quietly
  picking dev, because a default is exactly the thing that turns a forgotten argument into a
  destructive surprise.

- **The guard compares against a hardcoded literal, not an env var.** `TEST_PROJECT_REF` in
  `src/db/load-env.ts` is a string constant; every `:test` script aborts before doing anything if
  the resolved connection string does not contain it. *Why not read it from `.env.test`:* **a guard
  you can disable by forgetting to set a variable is not a guard.** The first version did read an
  env var, and it failed exactly that way within a day — `.env.test` predated the variable, so the
  guard threw "SUPABASE_TEST_PROJECT_REF is not set", which reads like a credentials problem. It
  cost a wrong diagnosis: the real credentials were fine and the migration chain had never been
  blocked. A guard whose absent configuration produces a *misleading* error is worse than one with
  no configuration to absent. The ref is not a secret — it appears in every connection string the
  guard inspects — so there is nothing gained by keeping it out of the repo, and the literal cannot
  go unset. `tests/unit/load-env.test.ts` pins all three cases, including that the guard still
  passes with `SUPABASE_TEST_PROJECT_REF` deleted from the environment.

- **There is deliberately no dev/prod-capable `db:reset` variant.** `db:reset` (dev) predates this
  work and stays; `db:reset:test` was added. Nothing was added that could drop `public` on a project
  chosen at runtime.

## `NODE_EXTRA_CA_CERTS` is set by a wrapper process, not by the env loader (2026-08-23)

`scripts/with-ca-certs.mjs` wraps every `db:*` / `db:*:test` script, setting
`NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem` when the variable is unset and that file exists, then
spawning the real command as a child process. Silent no-op otherwise. It never disables TLS
verification.

*Why it cannot live in `src/db/load-env.ts`, where it would naturally belong.* **Node reads
`NODE_EXTRA_CA_CERTS` once at process startup, before any application code runs.** Assigning
`process.env.NODE_EXTRA_CA_CERTS` from inside the already-running script has no effect on that
process's TLS store — the certificates are loaded before `load-env.ts` gets control. The variable
has to exist before the `tsx`/`drizzle-kit` process is spawned, so the only place the fix can work
is a parent process that sets it and then spawns the child. This was checked rather than assumed:
putting it in the env loader would have looked correct, changed nothing, and left the next person
debugging a fix that was already "in place".

*Why automate it at all.* Forgetting the prefix produces `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, which
reads like a credentials or network failure and is neither — Node's bundled CA bundle is
incomplete on this machine while the system store (`curl`) is fine. It cost a wrong diagnosis in the
same session it was introduced. A documented step a human has to remember, whose failure mode
misdirects, is a step worth removing.

*Scope.* Only `db:*` scripts are wrapped. `pnpm build` / `pnpm dev` / bare `tsx` still need the
manual export, and RUNBOOK keeps it as the documented fallback for machines whose CA bundle sits at
a different path. An already-set value is never overridden.

## Production 404 root cause, carried forward from the closed PR #6 (2026-08-24)

This text is carried forward verbatim from PR #6 (`fix/ci-build-step`), which was closed unmerged
on 2026-08-24 as too stale to rebase (19 commits behind `main`, `CONFLICTING`/`DIRTY`). The rule
below is correct and generally useful, so it is kept; the rest of that PR's docs changes were
discarded rather than resolved by hand.

Root cause: the Vercel project setting "Framework Preset" was "Other" instead of "Next.js." Vercel
ran the build but never applied Next's routing/output convention, so nothing was served.

Diagnostic note — middleware was wrongly named as first suspect in the earlier handoff. Middleware
runs inside the deployment, so a platform 404 with no x-matched-path exonerates it by definition:
if middleware were the cause you would see x-matched-path and an HTML response, and
`/_next/static/*` would still serve. Corrected. The general rule: x-vercel-error with no
x-matched-path means the request never reached the app, so nothing inside the app can be the
cause — look at project settings, not code.

## CI verify now runs `pnpm build` (2026-08-24)

`verify` ran lint, typecheck and unit tests, but none of those catch a build that compiles under
`tsc` and still breaks under the Next build — a route type error, a server/client boundary
violation, a bad import, an RSC mistake. Code passing every prior check could still fail on deploy.
Added `pnpm build` as a step after unit tests so a failing build no longer masks a failing test.

The build step runs with one hardcoded placeholder Supabase URL and no secrets. This is
deliberate: the failures this step exists to catch don't need real credentials, and putting real
Supabase or PayPal values into GitHub Actions would widen the secret surface with no added
coverage.

*Known limitation.* Because `NEXT_PUBLIC_*` is inlined at build time, this CI build bakes in a
fake, non-functional Supabase URL. It is a build-time gate only — it proves the bundle compiles,
it proves nothing about whether the app runs, and it will not catch a regression tied to
`NEXT_PUBLIC_SUPABASE_ANON_KEY` or any other `NEXT_PUBLIC_*` var, none of which are set. A green
`verify` must not be read as broader assurance than that.

Separately, `pnpm build` fetches the DM Sans font from Google Fonts at build time via `next/font`,
so the build — in CI and on Vercel — has a live network dependency on `fonts.googleapis.com` and
can fail for reasons unrelated to the code; on this machine that fetch fails locally with
`UNABLE_TO_GET_ISSUER_CERT_LOCALLY` because of the local Node trust store, and
`node scripts/with-ca-certs.mjs pnpm build` is the local workaround.

---

## Bubble live-app investigation — findings and six decisions (2026-08-24)

A four-part, read-only investigation of the live Bubble app (`nowtutors.com`) established how the
product actually behaves, correcting some earlier inferences and confirming others. Two items below
are **findings** (what was observed) and six are **decisions** (what the rebuild does about it) —
kept visibly distinct rather than folded together, since a finding records a fact about Bubble and a
decision records a choice this SPEC makes. SPEC §3.1, §7.4, §7.7, §7.11, §9, and §18 item 8 were
updated in the same commit (per the CLAUDE.md standing rule).

### Finding A — the session room is Agora, two-way; confirms the Phase 6/7 split

Corrects an earlier wrong reading in this project ("Agora is broadcast-only"), recorded here so it
is not re-derived. `live_session_room` (content type `Booking`) runs the Agora Web SDK in `rtc` mode:
the tutor publishes video + audio, the student publishes audio only, and both subscribe to the
other. Channel name is the booking's `agora_channel` field, set at booking creation as the literal
string `"channel_"` concatenated with the tutor's `UserProfile` id — one channel per tutor, not per
booking. Tokens come from `https://agora-token-service-3irp.onrender.com` at
`/rtc/{channel}/{role}/uid/0/?expiry=3600` — the same token server this rebuild reuses — with role
(`publisher` / `subscriber`) chosen client-side by comparing the current user's profile id to the
booking's tutor profile id. `live_classroom` separately hosts a subscriber-only preview of the
tutor's broadcast, on a channel keyed to the tutor's profile id, shown only when the tutor is live —
a broadcast preview widget, not a session. `Lessonspace` is used for scheduled bookings only, via
`POST /v2/spaces/launch/` passing only booking id, display name, and a leader boolean — no duration,
expiry, or time limit. **Consequence:** SPEC's split (Phase 6 Agora room, Phase 7 Lessonspace) is
correct and is now confirmed by the live app rather than inferred. SPEC §7.4, §7.7, §9 amended with
confirming notes; `agora_channel = session_{booking_id}` (§4.3, per-booking rather than per-tutor)
is unchanged — a deliberate, safer departure from Bubble's scheme, not something this finding
overrides.

### Finding B — no request/accept flow exists in Bubble

Bookings are created immediately on payment. There is no request data type, no accept step, no
expiry, no timeout. The tutor is pulled into the room by a `has_live_request` boolean on the `User`
record, polled by a 10-second interval on the index page, which then redirects the tutor; the flag
is cleared when the tutor lands in the room. **Consequence:** this rebuild's request/accept model
(`session_requests`, §7.4) has **no Bubble counterpart** — it is this rebuild's own design. The rule
that Bubble is ground truth for UX behaviour does not apply here, because there is no Bubble
behaviour to match. SPEC §7.4 amended with a note to this effect, so a future session does not go
looking for a Bubble flow to reconcile against.

### Decision 1 — replace the credit burn model

Bubble sets a booking's `credits_remaining` to a **flat bracket by duration** — 10/20/30/40 credits
for 30/60/90/120 minutes — which ignores the tutor's hourly rate entirely, so every tutor costs the
same in credits. A browser-side interval then decrements `credits_remaining` by 1 every 180 seconds
and ends the session at zero — the withdrawn "1 credit = 3 minutes" rule (Phase 6 pre-build entry,
above), still live and still governing session termination today. **Decided:** the rebuild does not
reproduce any of this. Credits are charged once at booking via `sessionPriceCredits()`
(`src/lib/credits/pricing.ts`) — `Math.ceil(hourlyRateCredits × durationMinutes / 60)`. No burn
clock, no `credits_remaining` field, no client-side metering; duration is enforced server-side from
`started_at`. The flat bracket is a pricing defect in the live app, not a model worth preserving.
SPEC §7.4 amended with a confirming note — this was already the built behaviour; the investigation
confirms it rather than changing it.

### Decision 2 — the client-side burn is a live revenue leak

Because metering runs in the browser, closing the tab stops the meter while the session room stays
open — the student continues being tutored without being charged. Recorded as an observed property
of the live app. This rebuild's server-side hard stop from `bookings.started_at` removes it by
construction, not by patching the symptom. SPEC §7.4 amended alongside Decision 1.

### Decision 3 — tutor earnings are paid before the session happens

Bubble increments the tutor's `total_earnings` at booking creation, unconditionally, on all three
booking paths, **before the session occurs**. There is no escrow, no completion trigger, no refund
logic, no cancellation workflow, and no no-show handling anywhere in the app. **Decided:** this
rebuild's held-earnings-on-completion model (§7.11) is a deliberate correction, not a divergence to
be reconciled — written into SPEC explicitly so a future session does not "align to Bubble" and undo
it.

### Decision 4 — `total_withdrawn` is never written; a live financial defect

The field exists on `UserProfile` and is **read** in the withdrawal gate
(`earnings × 0.75 − withdrawn ≥ $30`) but no workflow anywhere writes it. **Consequence:** a tutor
can submit repeated withdrawal requests against the same balance, and the displayed "available to
withdraw" never decreases after a request is submitted. Recorded as a known defect in the live app
affecting Phase 8 payouts. No fix now; it must not be reproduced — this rebuild has no
`total_withdrawn`-shaped counter to begin with, deriving "available" from the ledger instead (§7.11).

### Decision 5 — liveness confirms SPEC §3.1

Bubble has the exact `is_live` / `online_status` divergence §3.1 forbids. Loading the tutor
dashboard sets `online_status` only. A stale-tutor sweep clears both after 10 minutes of inactivity.
No confirmed write of `is_live = true` exists anywhere in the app. Tutor cards read `online_status`;
the dashboard indicator reads `is_live`. The two can disagree. Recorded as confirmation of the
existing rule, not a change to it. SPEC §3.1 amended with a confirming note.

### Decision 6 — the platform fee is 25%

Bubble's withdrawal maths pays out gross × 0.75 — a live commercial term. SPEC already stated
`platform_fee_percent = 25` (§4.7, §7.11, §18 item 8) before this investigation; the live figure
matches exactly, so this is a confirmation, not a change. SPEC §18 item 8 amended with a confirming
note.

### Carried for Noora (record only, not actioned)

Bubble's payout mechanism is a manual admin approval of a `WithdrawalRequest` followed by a PayPal
Payout. Relevant to the held Stripe Connect cross-border question (§2, "Not in the stack,
deliberately") — recorded here for when that question is revisited, not actioned in this pass.

---

## Phase 6 Part 3A — session room shell + Agora join (`feat/phase6-part3a-session-room`, 2026-08-24)

Two of these overrode the build brief, which asked for the opposite in both cases. Both were
escalated before any code was written and both were confirmed. They are recorded here because the
reasoning is not recoverable from the diff.

### 1. Both participants get a `publisher` token — the student is NOT a subscriber

The brief specified `publisher` for the tutor and `subscriber` for everyone else, framed as a
security improvement over Bubble's client-side role choice. It is not one, and it contradicted its
own next paragraph, which required the student to publish microphone audio.

An Agora RTC token minted with `Role_Subscriber` does not authorize publishing. Whether the SD-RTN
actually rejects the student's microphone depends on **co-host authentication**, a per-project
Agora console setting. Bubble has it off, which is the only reason the live app's
subscriber-token-that-publishes works at all (Finding A). Reproducing that would make a working
session depend on a console toggle nothing in this repo owns, guards, or would notice being
changed — and the failure mode is silent: the student is simply inaudible, discovered only when two
real people are in a room.

SPEC §9 step 2 already said `publisher` unconditionally for a session. The **media** asymmetry —
tutor publishes camera + microphone, student publishes microphone only — is real and is enforced in
`lib/agora/client.ts`, which is the layer that actually decides what gets published. The token
grants capability; the wrapper decides use. *Why it matters:* "the student may not send video" and
"the student may not send anything" are different rules, and only the first one is the design.
*How to apply:* asymmetry in what a peer publishes belongs in the media layer, not in the credential.

The security property the brief was reaching for is kept in full and is the actual improvement over
Bubble: role and identity are derived server-side in `lib/agora/session-access.ts`, from the booking
row. No request field feeds that decision, and the function's signature — `(row, userId)` — is the
enforcement. There is a unit test asserting exactly that.

SPEC §9's "Confirmed against the live app" note was **wrong** and is corrected in this commit. It
described Bubble's client-side comparison as "the same publisher/subscriber split this section
already specifies"; §9 step 2 specifies no split, and a client-chosen role is the thing §9 exists to
prevent. That sentence is what created the contradiction the brief inherited.

### 2. `started_at` is set when BOTH parties are present, not on first arrival

The brief said: on first join, if `started_at` is null, set it to `now()`. SPEC §4.3 defines the
column as "first moment both were present", and §7.7 step 4 implements exactly that for the sibling
LessonSpace flow.

This is a money bug, not a definitional quibble. §7.4 makes `started_at` the clock the server-side
hard stop measures against, with **no refund on early exit and no grace period**. Under first-arrival
semantics, a tutor who opens the room four minutes before the student burns four minutes off a
session the student paid sixty for, and there is no mechanism to give them back.

*Why it matters:* a clock that starts before the service does is a silent overcharge, and the
existing no-refund rule means it can never be corrected after the fact. *How to apply:* when a
timestamp drives billing, its definition is a spec question, not an implementation convenience.

### 3. The join write is one statement referencing the target row, not a CTE

`stampSessionJoin` (`db/queries/sessions.ts`) does the whole first-join decision in a single
`UPDATE`. The first draft computed the post-join `*_joined_at` values in a CTE and joined to it,
which reads better and is wrong: under READ COMMITTED, an `UPDATE` that blocks on a row another
transaction is writing re-evaluates its qualifiers and its `SET` expressions against the **updated**
row once the lock clears, but a CTE is materialized from the original snapshot and is not re-read.
Both parties clicking join in the same instant would have had the second write push back the stale
null and erase the stamp the first had just made.

Referencing `b.*` directly in the `CASE` expressions costs some repetition and buys correctness under
exactly the concurrency this route sees. `started_at` tests the *other* party's column, because
after the statement the arriving side is stamped by definition — so the pair is complete precisely
when the other side already was.

*Why it matters:* "one statement" is not the same as "atomic against a concurrent writer" once a CTE
is involved. *How to apply:* in a self-referential conditional `UPDATE`, read the target table, not a
snapshot of it.

### 4. First-join writes live in the token route, not a separate Server Action

Mirrors SPEC §7.7 step 4, where the LessonSpace join route stamps `*_joined_at` at link issuance. A
browser cannot reach a channel without asking this route for a token, so the stamp cannot be skipped
by simply not calling something afterwards — which a post-join Server Action could be. Every write is
idempotent, so the token renewal Part 3B adds will re-run it harmlessly.

### 5. `{ bookingId }`, not `{ channel }` — and the same 404 for missing and forbidden

SPEC §9 previously specified `{ channel, purpose }` with the booking id parsed back out of the
channel string; the route now takes the id and reads the channel off the row. A caller cannot name a
channel they were not admitted to, and the id is what the client holds after the §7.4 handshake.
SPEC §9 amended in this commit.

The brief asked for **403** for a non-participant. It also asked, two steps later, that the room not
leak whether a booking exists — and a 403 leaks exactly that, since it distinguishes "exists but not
yours" from "does not exist". Both return **404**, matching `checkDirectPayEligibility` and
`getBookingDetailForParticipant`, which already made this call for the same reason.

### 6. Token TTL, timeouts, and the wildcard uid

The token is minted at the service's `uid/0` — a **wildcard**, valid for any uid, not "uid zero". The
per-user deterministic uid (§9 step 4) is what the client joins under. Minting per-uid tokens would
buy nothing: both uids in a session derive from ids the server has already authorized.

`expiresAt` is reported five minutes before the token's real one-hour expiry, so Part 3B's renewal
begins while the current token is still valid. The fetch timeout is **45s** and the route's
`maxDuration` is **60s**, because Render's free tier sleeps and SPEC §9 measures the first request
after idle at 30–50 seconds (a probe during this build took 22s). A tighter timeout would turn every
cold start into a failed join. The `/ping` warm ping now in `cron/sweep-presence` is what makes
reaching that ceiling rare; the generous timeout is what stops it being fatal when the sweep has not
run recently enough.

### What is NOT here

No migration, no RLS change, nothing in `lib/credits/`, no LessonSpace. End-session, elapsed time and
the hard stop are Part 3B; `tutor_earnings` and the completion cron are Part 3C. The control bar is
absent rather than stubbed — an inert control that looks live is worse than one that is not there.

### Known gap

The `started_at` rule is enforced in SQL and the unit suite runs without a database, so it has no
unit test. The pure pieces around it — participation, role derivation, the token path, the uid — are
covered in `tests/unit/agora-session-access.test.ts` and `tests/unit/agora-token-contract.test.ts`.
Verifying "both parties join, `started_at` is written once, a refresh does not move it" needs the
test Supabase project or an E2E pass, and is worth adding when Part 3B makes the clock observable.

## Phase 6 Part 3A — `started_at` concurrency coverage (`test/session-join-concurrency`, 2026-08-24)

Closes the known gap that was blocking Part 3B. No shipped behaviour changed: `stampSessionJoin` is
byte-for-byte what PR #29 merged, and the four assertions below run against it unmodified.

### 1. A DB-backed lane, not a new file in `tests/unit/`

The unit suite runs without a database **by design** — the accept transaction, the ledger and
settlement are all storage-agnostic precisely so their decisions are testable without a live
Postgres. That design has one blind spot, and `stampSessionJoin` sits squarely in it: the rule
being tested is not a decision *in* TypeScript, it is a property of how Postgres re-evaluates a
blocked `UPDATE` under READ COMMITTED. No fake, in-memory store or mocked driver reproduces it —
a test that could pass without a server would not be testing the thing at all.

So `vitest.integration.config.ts` is a second config with `include: ["tests/integration/**"]`,
disjoint from the unit lane's `tests/unit/**`. `pnpm test` cannot pick these files up, and
`pnpm test:db:test` is the only way to run them. *Why it matters:* the DB-free property of the unit
suite is worth keeping absolute — the moment one file in it needs credentials, "run the tests"
stops being a thing anyone can do on a clean checkout. *How to apply:* when a rule lives in SQL,
give it a lane rather than weakening the lane that deliberately has no database.

### 2. NOT in the CI `verify` job — deliberately, and this must stay true

The GitHub runner has no Postgres and no `.env.test` (gitignored, live credentials). Adding this
step to `verify` would fail the **required** check on every PR for missing infrastructure rather
than for a broken assertion — the worst kind of red, because it trains everyone to ignore it. It is
a local, pre-Part-3B gate: run it by hand against the disposable test project before touching the
`started_at` column or anything computed from it.

The guard against it drifting in is that it is a separate config and a separate script, not a
`describe.skipIf` inside the unit suite. *Why it matters:* a required check that goes red for
environmental reasons costs more trust than the coverage buys. *How to apply:* infrastructure-
dependent suites get their own invocation, and the reason they are excluded gets written down where
the next person will look — here, `vitest.integration.config.ts`, and SPEC §15.

### 3. Real connections and a real lock, not two awaited calls

Two `postgres` clients at `max: 1` on the **session pooler** (`sessionPoolerUrl()`, :5432) — not
`DATABASE_URL`, which is the :6543 transaction pooler and hands a server connection back to the
pool between statements, the exact opposite of holding a transaction open. Connection A stamps and
holds; connection B issues the same statement for the other party and blocks; a third connection
asks Postgres to confirm it (`pg_blocking_pids`) before anything is asserted; then A commits and B
re-evaluates against the row it was waiting on.

`await stamp(student); await stamp(tutor)` would have passed against the CTE draft this whole thing
exists to rule out. *Why it matters:* a concurrency test that never contends is a slower version of
the sequential test standing next to it. *How to apply:* if the test does not observe the block, it
is not testing the race — assert the block, do not infer it from a sleep.

### 4. The shipped signature was not widened for the test

`stampSessionJoin(bookingId, userId)` imports the `@/db` singleton and takes no executor. Adding an
optional transaction parameter would have been the easy way in — and would have put a
test-only affordance on the one write that governs billing. Instead the test mocks `@/db` with an
object forwarding to whichever transaction is current for the async context (`AsyncLocalStorage`),
so two racing calls each get their own connection through an unmodified function.

Two mechanical notes for whoever extends this: `server-only` is not an installed package (only
Next's bundler aliases it), so the integration config aliases it to Next's own empty shim; and the
`profiles.id → auth.users.id` FK (`drizzle/0002`) is why the fixture reuses seeded profiles and
creates only a `bookings` row, which `afterEach` deletes.

### 5. The test was proved capable of failing before it was trusted

`stampSessionJoin`'s `UPDATE` was temporarily rewritten into the CTE form described in item 3 of the
Part 3A section above, and the suite re-run. **Exactly one test failed — the concurrent one** — and
the failure was the predicted one: the blocked statement wrote back its stale snapshot, leaving
`student_joined_at` **null** (erasing the stamp the other transaction had just committed) and
`started_at` never written at all. The other three passed against the broken implementation, which
is the point: they are not the ones carrying this property. The CTE version was then reverted and
the suite re-run green.

*Why it matters:* a suite that would also be green against the known-broken implementation is worth
less than no suite, because it converts "unverified" into "verified" without doing the work. *How to
apply:* when a test exists to rule out one specific defect, reintroduce that defect once and watch
it fail before believing the green.

### Found, not fixed — a type-vs-runtime mismatch Part 3B will hit

Drizzle's raw `execute()` returns `timestamptz` as a **string**, not a `Date`, because it disables
postgres-js's type parsers and relies on column mappers a raw `sql` query does not have. `JoinStamp`
declares `Date | null` for `studentJoinedAt` / `tutorJoinedAt` / `startedAt`; at runtime all three
are strings like `2026-08-24 10:48:18.051472+00`. It is **latent today** — `/api/agora/token` reads
only `agoraChannel` — and was therefore left alone here, since this pass changes no shipped
behaviour. **Part 3B computes elapsed time from `startedAt`, and `.getTime()` on a string throws.**
Fix it there, in the pass that has a reason to touch the column. The test normalises both shapes
(`toEpochMicros`) rather than asserting a `Date`, so it will keep passing either way.
