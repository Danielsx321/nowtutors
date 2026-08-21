# NowTutors — Progress (resume-from-cold)

_Read this first. Authoritative spec: `docs/SPEC.md`. Decisions log: `docs/DECISIONS.md`._

## Current state (2026-08-21)

**Phases 0–3 are complete and merged to `main`.**

- **Phase 0** — foundation scaffold (PR #1, `56cc101`).
- **Phase 1** — data layer: 21 tables + 16 enums, 7 migrations, RLS, `live_tutors` /
  `public_profiles` views, seed + `db:verify-rls` (PR #2, `e9c33c4`).
- **Phase 2** — design system: all 34 §10.2 primitives, `/dev/kitchen-sink`, layouts, and the
  **ink amendment** (single `#34495E` ink surface, dual focus rings, density pass) (PR #3, `f433430`).
- **§18 resolution** — the open product questions settled as docs + seed: credits are money not
  time, flat instant pricing, no cancellation, 25% fee, five credit packages.
- **Phase 3** — auth, onboarding, browse/filter, profiles, editor, approval queue with re-review,
  favourites, storage/avatars. **Merged via PR #4.**
- **Branch protection is ACTIVE on `main`** ✅ — ruleset targeting `main` only, with **`verify`
  required**, PR required before merging, branches must be up to date, force pushes blocked and
  deletions restricted. CI is no longer advisory: the Phase 6 ungraceful-exit E2E now has something
  enforcing it. Changes to `main` go through a PR.

## What Phase 3 built

- **Auth** (`(auth)` group + `/auth/callback`): login, signup, forgot/reset password, Google OAuth.
  One zod schema per form, defined once and **re-parsed server-side** — the server never trusts the
  client's parse. Safe errors: neither login failure nor password reset reveals whether an email
  exists. Google-on-existing-email **links rather than duplicates**; `db:verify-rls` asserts it.
- **Onboarding** (`/onboarding`): role choice (immutable afterwards), student flow (name, avatar,
  timezone, subjects of interest → `student_subjects`), tutor flow (profile + subjects + levels +
  payout → `approval_status = 'pending'`). One transaction, keyed by the guard-authenticated user.
- **Guards** (`src/lib/auth/guards.ts`): wired into the `(student)` / `(tutor)` / `admin` layouts
  **and** re-checked as the first statement of every action and route handler (§5 Layer 2).
- **Browse** (`/`, `/tutors` redirects): filter rail + tutor grid, keyset pagination 24/page,
  anonymous works. **Credit price bands** compared directly against `hourly_rate_credits` — no USD
  conversion. Filter composition is a pure, DB-free function with **32 unit tests** exhaustive over
  every set/unset combination (§3.3). Present-but-invalid `sort` / `price` / `minRating` are
  **rejected loudly**; unknown `subject` / `lang` slugs yield an empty result set (§7.2).
- **`/tutors/[slug]`** — public profile. No ratings or reviews (dropped for v1). Only approved,
  non-suspended tutors are reachable; everything else **404s**.
- **`/tutor/profile`** — the tutor's own editor, reusing the onboarding schema via `omit`/`extend`.
  `approval_status`, `approval_note`, `slug` and `role` are not editable and are rejected
  server-side, with DB triggers as the backstop.
- **Re-review on material change** — an approved tutor's edit goes **live immediately** and
  `approval_status` is untouched; a material edit stamps `profile_changed_at` via trigger. Subjects
  are diffed, so a no-op save cannot flag.
- **`/admin/tutors`** — pending queue + edited-since-review queue, approve / reject (note required) /
  mark reviewed, every transition writing `audit_log`.
- **`/dashboard/favourites`** — the student's saved tutors, same card and derived live treatment.
- **Storage/avatars** — public `avatars` bucket with owner-folder write, `next/image`
  `remotePatterns`, initials fallback. (This was the Bubble "photos not rendering" bug.)
- **Live status derives from the `live_tutors` view, never `is_live`** (§3.1) — on the card and on
  the profile page alike.

## Phase 4 is next — availability and scheduled bookings

Do **not** start until told. Scope (SPEC §7.3, §4.2, §4.3):

- **Availability rules + exceptions** — weekly rules editor and date exceptions (`/tutor/availability`).
- **Slot computation** — server-side, in the student's timezone with the tutor's shown as secondary.
  DST boundaries, cross-timezone and back-to-back bookings are non-negotiable unit coverage (§15).
- **Scheduled bookings paid in credits** — price is
  `ceil(hourly_rate_credits × duration_minutes / 60)` via `src/lib/credits/pricing.ts`, debited
  through the ledger in the same transaction that creates the booking. Durations 30/60/90; at most
  7 days ahead; 120 minutes' minimum notice.
- **Booking lists and detail pages** for both sides.

> **Cancellation and refunds are NOT in scope** (§18): there is **no cancellation path for either
> party and no refunds** on the normal path (`cancellation_enabled = false`). The only unwind is an
> **admin force-cancel with refund**. The `cancelled_by_*` / `no_show_*` booking statuses stay in the
> enum but are admin- or cron-set only, never user-set. Do not build a user-facing cancel button.

## Still open — carry forward

- **⚠️ Production deploy returns a Vercel edge 404 on all routes.** Deployment `be218c5` is
  **Ready / Production / Current** with all three domains attached (`nowtutors-brown.vercel.app` is
  the project alias), the build log is clean with all **16 routes compiled**, and Deployment
  Protection has been disabled. Vercel's own preview thumbnail also shows the 404. Since the build
  succeeds and the alias is correct, requests are likely **not reaching the app** — middleware
  (91.4 kB, runs on every route) or routing config is the first suspect. **Next step:** Runtime Logs
  on that deployment, to see whether requests arrive at all and what they return. Local dev works;
  **does not block Phase 4.**
  - **`nowtutors.vercel.app` (no `-brown`) belongs to an unrelated third party. Do NOT point
    nowtutors.com at it.**
- **Bump the GitHub action versions to `@v5`** (`actions/checkout`, `actions/setup-node`,
  `pnpm/action-setup` are on `@v4` and warn as deprecated Node-20 runtimes).
- **Obsolete pricing remnants — one cleanup migration when Phase 6 opens.**
  `tutor_profiles.instant_rate_credits_per_minute` is retained-but-unused, and the
  `instant_hold` / `instant_release` / `instant_capture` `credit_transaction_type` values are
  obsolete now that instant billing is a single flat `booking_debit`. Dropping a column and pruning
  an enum is a migration, so it was not folded into a docs-only change.
- **Approval and rejection emails are `TODO(Phase 10)` hooks — nothing is sent.** The hooks are
  marked in `src/actions/admin-tutors.ts`; Resend wires in Phase 10.
- **Tutor profile diff view not built.** The admin "Edited since review" tab flags the profile and
  timestamps it (changed at / last reviewed) but does not show *what* changed — that needs a history
  table or a stored snapshot, which is a design decision rather than a cheap add. Deferred.
- **User Role option-set values** — confirm against Bubble (we assume student/tutor/admin).
- **`credit_transaction_type` value check** — confirm the ledger enum values match the current build.

## Notes / non-bugs (do NOT re-investigate)

- **Bubble drives session length from a client-side countdown** (status = `Completed` when
  `credits_remaining <= 0`, then `endSession()`). The rebuild computes elapsed time **server-side
  from `started_at`**. Not ported.
- **Theo's blank avatar circle** is expected: the seed uploads a **1×1 transparent PNG** for
  `theo-chen` purely to prove the Storage → `next/image` pipeline. Not a rendering bug.
- All other tutors show **initials** (no uploaded avatar) — also expected.
- Every seeded tutor reads **"Offline"** because presence does not exist until Phase 6 — correct,
  the status derives from the `live_tutors` view.
- **`db:verify-rls` mutates seeded rows** (it makes a material edit to `tutor1` to prove the
  re-review flag survives). Re-run `pnpm db:seed` afterwards to restore a tidy dev dataset.

## Env / toolchain gotchas

- **Export `NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem`** for any pnpm/tsx/build/db command (Node's
  bundled CA rejects the Supabase chain; curl/system CA is fine). Every gate/seed/dev run needs it.
- **Migrations + admin scripts run over the Supabase session pooler** (port 5432); the legacy
  `db.<ref>.supabase.co` direct host does not resolve. Runtime Drizzle uses `{ prepare: false }`.
- **zsh quotes special chars.** Quote args containing `#`, `(`, `)`, or globs — e.g. the
  `src/app/(public)/…` route-group paths and `grep --include='*.ts'`.
- **`pnpm db:reset` is destructive** (drops `public`) — **dev only**. `.env.local` holds dev creds
  (ref `mipnoxlhurdbaahmvhhx`, eu-west-3); no prod project yet.
- Seed login password for all seeded users: `Password123!` (`student1@nowtutors.dev`,
  `tutor1@nowtutors.dev`, `admin@nowtutors.dev`).
- **Run the local gates before pushing**: `pnpm typecheck && pnpm lint && pnpm test && pnpm build &&
  pnpm db:verify-rls`. CI (`verify`) is now a required check on `main`, so a red gate blocks the
  merge rather than merely warning — but `db:verify-rls` needs dev credentials and runs locally only.
