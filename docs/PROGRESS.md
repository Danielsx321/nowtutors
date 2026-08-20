# NowTutors — Progress (resume-from-cold)

_Read this first. Authoritative spec: `docs/SPEC.md`. Decisions log: `docs/DECISIONS.md`._

## Current state (2026-08-20)
- **Phase 0** (foundation scaffold): merged to `main` via PR #1 (`56cc101`).
- **Phase 1** (data layer): merged to `main` via PR #2 (`e9c33c4`).
- **Phase 2** (design system + ink amendment): **DONE — merged to `main` via PR #3** (merge SHA
  `f433430`). Included the `cn()`/tailwind-merge **type-scale fix** (`b7c8ebf`) and the Phase 2
  **ink amendment** (`76c1d3a`, Bubble parity): single-surface ink palette (**`#34495E`**,
  `ink-950/900/800/700/300`; `ink-800` = interaction state), `PriceTag`/`RatingStars` ink variants,
  **dual focus rings** (purple on light, gold on ink), density pass, kitchen-sink Foundations
  section, SPEC §10.1/§10.2/§10.3 + DECISIONS entries.
- **§18 resolution + fee-split + CI fix** landed on `main` after the merge (docs+seed, no schema):
  settings/billing/cancellation resolved (`3221ada`, `4db8fe6`), authoritative earnings
  `splitEarnings` helper (`184384c`), CI pnpm/Node pin (`bab9b0c`). **`main` HEAD = `bab9b0c`.**
- **Phase 3** (auth/onboarding/profiles/browse): **browse checkpoint** (`cf4e5b8`) on
  `phase-3-auth-onboarding-browse`, **rebased onto `main` (`bab9b0c`) this session** — the rebase
  pulled in the ink amendment + `cn()` fix, folded main's §18 seed values over phase-3's seed, and
  applied the two §18 subject-name corrections (#3 ESL, #11 Speaking Prep). Only the **browse path**
  is built — the rest of the phase is the next batch (below). Plan:
  `~/.claude/plans/phase-3-plan-eager-music.md` (approved, 4 user amendments folded in).

## Phase 3 — built & committed (`cf4e5b8`)
- **Filter composition** (the phase's highest-value deliverable): `src/lib/tutors/filters.ts` —
  `parseTutorSearchParams` (URL→normalized query) + `composeTutorFilters` (only-set-filters →
  Drizzle conditions). Standalone, DB-free. **30 unit tests** exhaustive over every set/unset
  combination (`tests/unit/tutor-filters.test.ts`). Price bands convert USD→credits via
  `usdPerCredit` injected from `credit_usd_rate` (cached `src/lib/settings.ts`).
- **Browse:** `/` = filter rail + tutor grid (`src/app/(public)/page.tsx`); `/tutors` redirects to
  `/` forwarding params (`src/app/(public)/tutors/page.tsx`). Query in `src/db/queries/tutors.ts`
  (Drizzle): approved `tutor_profiles` ⋈ `public_profiles`, suspended owners excluded via base
  `profiles`, keyset pagination 24/page, anonymous works. `public_profiles`/`live_tutors` modelled
  with Drizzle `.existing()` in `src/db/schema/views.ts`.
- **Card live status derives from `live_tutors`, never `is_live`** (§3.1) → `offline`/`online`/`live`.
  `src/components/features/tutor-card.tsx` (first composed component) + `favourite-heart.tsx`
  + `tutor-filters.tsx` (URL-driven rail + mobile drawer).
- **Favourites** (parity): `favourites` table + RLS (migration `drizzle/0008`, SPEC §4.8),
  `src/db/schema/favourites.ts`, guarded `toggleFavourite` (`src/actions/favourites.ts`), browse
  left-join for per-card state. Anon heart → `/login`; tutor/admin hidden.
- **Storage/avatars** (the Bubble bug): migration `drizzle/0007_storage_avatars.sql` (public
  `avatars` bucket + `storage.objects` owner-folder policies); `next.config.ts` `remotePatterns`;
  `Avatar` now uses `next/image`.
- **Guards** `src/lib/auth/guards.ts` + Supabase SSR clients `src/lib/supabase/{server,client}.ts`.
- **Seed** rewritten: 26 canonical subjects, 9 languages, tutors across every price band + language,
  1 pending tutor, 1 suspended-owner fixture, favourites, a sample avatar upload. Migrations
  `0007`+`0008` apply clean from empty; `pnpm db:reset && db:migrate && db:seed` all pass.
- Verified: typecheck/lint/build green; 30 filter tests pass; `/` and `/tutors` render at 360px &
  1440px; `/tutors?price=25_50` → `/?price=25_50` applies the filter end to end.

## Phase 3 — still to build (the next batch)
Do **not** start until the user says so.
- **Auth pages + actions** (`(auth)` group + `/auth/callback` + `src/actions/auth.ts`):
  login/signup/Google/forgot/reset. Google-on-existing-email **links, not duplicates** (§7.1;
  enable same-email linking in the dashboard — RUNBOOK).
- **Onboarding** (`/onboarding` + `src/actions/onboarding.ts`): role choice, student + tutor flows.
- **Wire guards into the layouts** `(student)`/`(tutor)`/`admin` (Phase 2 left comments there) AND
  first-line in every action/route — never rely on the layout (§5). Guards exist; wiring doesn't.
- **`/tutors/[slug]`** tutor profile page (no calendar/CTA — that's Phase 4) + **tutor profile
  editor** + shared account settings.
- **Admin approval queue** `/admin/tutors` (`src/actions/admin-tutors.ts`, service-role writes to
  approval columns + `audit_log`). Approval email deferred to Phase 10.
- **`/dashboard/favourites`** (a `TutorCard` grid of the student's favourites).
- **RUNBOOK.md** additions (dev "Confirm email" disabled, Google linking, storage policy ownership
  caveat) and **verify-rls** extension (student favourites own-only; storage upload own-folder;
  card `liveStatus` reads `offline` for a stale `is_live=true` tutor).

## Open design notes to address ON THE BROWSE VIEW (from the user's checkpoint review — carry forward)
These are **parity-toward-Bubble visual adjustments**, not new features. Make them before calling
the browse view done.
- **(a) Darker shell, not the all-white flat layout.** The current Bubble build's browse is darker;
  move the browse palette toward it using the existing §10 **ink/purple tokens** and the Phase 2
  **`AppShell`** frame (dark chrome) rather than the plain white `(public)` shell it's in now.
- **(b) Tighten the spacing.** It reads too sparse/minimal — too much whitespace between the filter
  rail, the cards, and the grid gutters. Reduce the gaps/padding for a denser, closer-to-Bubble grid.

## Notes / non-bugs (do NOT re-investigate)
- **Theo's blank/solid avatar circle** in the browse grid is expected: the seed uploads a **1×1
  transparent PNG** for `theo-chen` purely to prove the Storage → `next/image` (`remotePatterns`)
  pipeline. It is not a rendering bug. A real photo will look normal; swap the seed image if a nicer
  sample is wanted.
- All other tutors show **initials** (no uploaded avatar) — also expected.
- Every seeded tutor reads **"Offline"** because presence doesn't exist until Phase 6 — correct
  (the card derives status from the `live_tutors` view).

## Env / toolchain gotchas
- **Export `NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem`** for any pnpm/tsx/build/db command (Node's
  bundled CA rejects the Supabase chain; curl/system CA is fine). Every gate/seed/dev run needs it.
- **Migrations + admin scripts run over the Supabase session pooler** (port 5432); the legacy
  `db.<ref>.supabase.co` direct host does not resolve. `drizzle.config.ts` + `src/db/session-url.ts`
  derive the pooler URL from `DATABASE_URL`. Runtime Drizzle uses `{ prepare: false }` (txn pooler).
- **zsh quotes special chars.** Quote args containing `#`, `(`, `)`, or globs — e.g. the
  `src/app/(public)/…` route-group paths, `grep --include='*.ts'`, and any `#`-bearing string —
  or zsh errors with `no matches found` / mis-parses. Use `git mv "src/app/(public)/page.tsx"`.
- **`pnpm db:reset` is destructive** (drops `public`) — **dev only**. `.env.local` holds dev creds
  (ref `mipnoxlhurdbaahmvhhx`, eu-west-3); no prod project yet.
- pnpm native builds denied by default (`pnpm-workspace.yaml allowBuilds`).
- Seed login password for all seeded users: `Password123!` (e.g. `student1@nowtutors.dev`,
  `tutor1@nowtutors.dev`, `admin@nowtutors.dev`).

## Still open before later phases
- **⚠️ `credit_usd_rate` ↔ §18 conflict (surfaced by this rebase — needs Daniels' decision).** The
  browse price-band filter converts USD bands → credit bounds using a `usdPerCredit` read from
  `platform_settings.credit_usd_rate` (`src/lib/settings.ts` → `getCreditUsdRate`, consumed by
  `src/lib/tutors/filters.ts` + `src/app/(public)/page.tsx`). But **§18 removed `credit_usd_rate`**
  (pricing is per-package; there is no flat rate) and the seed no longer sets it — so at runtime
  `getCreditUsdRate()` silently falls back to its `0.5` default. Nothing crashes and the 30 filter
  tests pass (they inject `usdPerCredit` directly), but the browse bands now run on an orphaned rate
  the data model no longer sanctions. **Left as-is (not guess-fixed) pending a decision on how the
  price bands should derive a USD↔credit figure now.**
- **User Role option-set values** — confirm against Bubble (we assume student/tutor/admin).
- **`credit_transaction_type` value check** — confirm the ledger enum values match the current build.

## What Phase 2 built
Design system (SPEC §10). Tokens completed in `globals.css` (paired type scale, shadows,
`container-page`/`focus-ring` utilities, hand-rolled Radix keyframes under reduced-motion). All
**34 §10.2 primitives** in `src/components/ui/` (kebab-case + barrel), on shadcn stack
(Radix + CVA + `cn`, sonner toasts, react-day-picker calendar — both mapped to tokens, no
stylesheet/palette leak). `/dev/kitchen-sink` renders every primitive in every state with a
**light/ink surface toggle** (dev-only via `dev/layout.tsx`). Layouts: public header/footer
(`(public)/layout.tsx`) + authenticated `AppShell` (dark sidebar + topbar + mobile drawer) wired
into `(student)`/`(tutor)`/`admin` layouts — **presentational, guards deferred to Phase 3**.
`src/app/page.tsx` moved into `(public)/` (single `/` resolver).
**Ink amendment (this session):** the authenticated shell is now an **ink frame (sidebar + topbar)
→ white content panel → ink cards** — superseding the earlier "dark sidebar + white topbar + light
content" ruling (see DECISIONS.md). Topbar flipped light → ink; `Card`/`StatCard`/`PriceTag`/
`RatingStars` gained ink treatments; scrims → `ink-950`.
Verified: typecheck/lint/test/build green (exit 0); grep proof clean (no hex/`rgb`/`rgba`/`hsl`/
non-brand palette outside `globals.css`); kitchen sink runtime-checked at 360px & 1440px, light + ink.
Composed components (11) deferred to feature phases — see DECISIONS.md.

## Done this session (the rebase batch)
1. **Rebased `phase-3-auth-onboarding-browse` onto `main` (`bab9b0c`)** — pulls in the ink amendment
   + `cn()` fix. Seed: main's §18 settings/packages won; phase-3's canonical 26-subject list kept
   with the two §18 corrections applied (#3 ESL, #11 Speaking Prep). Docs (DECISIONS/SPEC/PROGRESS)
   and `package.json` merged keeping both sides.
2. **`TutorCard` restyled** to the amendment §3 spec (`ink-900` surface, `ink-700` border, white
   name/price, `ink-300` secondary, `ink-800` subject chips, `live-400` LIVE fill with `ink-900`
   text, `ink-800` hover, `focus-ring-on-ink`); the three ink states (offline/online/live) added to
   the kitchen sink. Gates green; dev server handed to Daniels.

## Next — Daniels reviews in the browser BEFORE anything else is built
- **Density is Daniels' judgement call, not an automated one — do NOT adjust it pre-review.** The
  "too sparse" read that motivated the Phase 2 density pass came from a render taken while `cn()`
  was suppressing font sizes, so it must be re-evaluated against CORRECT type sizes. Also verify the
  browse renders ink shell → white panel → ink cards, and revisit the checkpoint notes below
  ((a) darker shell / (b) tighten spacing) against the now-correct tokens.
- **Decide the `credit_usd_rate` ↔ §18 question** (see "Still open" above).
- **Then resume the Phase 3 batch:** auth pages + actions (login/signup/Google/reset), onboarding
  (both roles), guards wired into the layouts, `/tutors/[slug]` + tutor profile editor, admin
  approval queue (`/admin/tutors`), `/dashboard/favourites`.

## Phase 3 decisions (do not re-litigate — see `docs/DECISIONS.md`)
Canonical 26 subjects (**#3 → "English as a Second Language (ESL)"**, **#11 → "Live IELTS / TOEFL
Speaking Prep"** corrected per §18; #6/#10 confirmed correct), 9 languages, role enum keeps `admin`,
favourites parity, `/`=browse + `/tutors` redirect, card live from the `live_tutors` view,
price-band USD↔credit conversion (see the `credit_usd_rate` open item above), rating
supported-but-unsurfaced, `public_profiles`/`is_suspended` browse deviation, storage bucket public +
owner-folder write, migration numbering (`0007` custom snapshot copy, `0008` generated), the seed's
`DISABLE TRIGGER profiles_guard` for the suspended fixture, and the new deps.

## Known environment issue — CI is down (billing lock)
**GitHub Actions is locked by an account-level billing flag.** Runs #10 and #11 failed at ~2s with
**zero steps** — the runner never starts. This is **not a code failure**. Support ticket open.
Consequence right now: **CI is advisory only, and required status checks are NOT configured on
`main`** (PR #3 merged with a normal merge-commit, no override needed). **Both must be resolved
before Phase 6**, where the ungraceful-exit (`live_tutors` staleness) regression test is meant to
run in CI. Until then, local gates + runtime checks are the only signal — treat them as mandatory.
