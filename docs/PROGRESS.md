# NowTutors — Progress (resume-from-cold)

_Read this first. Authoritative spec: `docs/SPEC.md`. Decisions log: `docs/DECISIONS.md`._

## Current state (2026-08-19)
- **Phase 0** (foundation scaffold): merged to `main` via PR #1 (`56cc101`).
- **Phase 1** (data layer): merged to `main` via PR #2 (`e9c33c4`). `main` now carries the full
  scaffold + data layer.
- **Phase 2** (design system): committed on `phase-2-design-system`, branched off the updated
  `main`. **PR not yet opened** (ask before pushing/opening).

## What Phase 1 built
21 tables + 16 enums (Drizzle, `src/db/schema/` 8 files) · 7 migrations (`drizzle/0000` generated core + `0001`–`0006` custom SQL: btree_gist overlap exclusion, auth.users FK + signup trigger, updated_at/presence/anti-escalation triggers, `live_tutors` + `public_profiles` views, RLS 45 policies, Realtime) · `db:seed` / `db:verify-rls` / `db:reset`.
Verified: clean migrate from empty, RLS denials/allows pass, wallet=ledger 0 drift, lint/typecheck/test/build green.

## Decisions (do not re-litigate — see `docs/DECISIONS.md`)
The 8 schema decisions + Decision A (payout split table) + Decision B (`public_profiles` DEFINER / `live_tutors` invoker), and the Bubble-export deltas: `phone` dropped, `reviews` deferred, `broadcasts` net-new, instant rate nullable (derives `hourly/60`), `intro_video_url` kept. All recorded in DECISIONS.md.

## Env / toolchain gotchas
- **Migrations run over the Supabase session pooler** (port 5432); the legacy `db.<ref>` direct host does not resolve. `drizzle.config.ts` + `src/db/session-url.ts` derive it from `DATABASE_URL`.
- **This Mac needs `NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem`** exported for any pnpm/tsx/build/db command (Node's bundled CA rejects the chain; curl/system CA is fine).
- Runtime Drizzle client uses **`{ prepare: false }`** (`DATABASE_URL` = transaction pooler).
- **`pnpm db:reset` is destructive** (drops `public`) — **dev only**. `.env.local` holds dev creds (ref `mipnoxlhurdbaahmvhhx`, eu-west-3); no prod project yet.
- pnpm native builds denied by default (`pnpm-workspace.yaml allowBuilds`).

## Still open before later phases
- **Real Subjects list** (seed uses 8 placeholders) — pending Bubble Subjects export.
- **User Role option-set values** — confirm against Bubble (we assume student/tutor/admin).
- **`credit_transaction_type` value check** — confirm the ledger enum values match the current build.
- **Noora's §18 settings** — credit_usd_rate, platform_fee_percent, earnings_hold_hours, cancellation/refund policy, etc. (all seeded as provisional placeholders in `platform_settings`).

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
Verified: typecheck/lint/test/build green; grep proof clean (no hex/`rgb`/`rgba`/`hsl`/non-brand
palette classes outside `globals.css`); kitchen sink checked at 360px & 1440px, light + ink.
Composed components (11) deferred to feature phases — see DECISIONS.md.

## Next up
**Phase 3 — Auth, onboarding, profiles, browse** (do not start until told). Adds the Phase 3 route
guards (`requireRole`, tutor-approval gate) to the shells built here, plus signup/login/Google/
reset, onboarding, tutor profile editor, `/tutors` filters + `/tutors/[slug]`, avatar upload +
`next/image` `remotePatterns`, and the first composed component (`TutorCard`).
