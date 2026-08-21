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
