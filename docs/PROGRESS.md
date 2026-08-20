# NowTutors — Progress (resume-from-cold)

_Read this first. Authoritative spec: `docs/SPEC.md`. Decisions log: `docs/DECISIONS.md`._

## Current state (2026-08-20)
- **Phase 0** (foundation scaffold): merged to `main` via PR #1 (`56cc101`).
- **Phase 1** (data layer): merged to `main` via PR #2 (`e9c33c4`).
- **Phase 2** (design system + ink amendment): **DONE — merged to `main` via PR #3.**
  Merge SHA **`f433430`** (parents `e9c33c4` + `76c1d3a`). `main` now carries scaffold + data layer
  + the full design system.
  - **Record correction:** an earlier checkpoint described the Phase 2 PR as "held." It had in fact
    **never been pushed** — no remote branch, no PR existed. This session pushed
    `phase-2-design-system` and opened PR #3 for the first time, after folding in the ink amendment
    below, then merged it (normal merge-commit; no admin override needed).
- The two commits added this session, on top of the original Phase 2 work (`89f9a2d`, `0d66458`):
  - **`b7c8ebf`** — `fix(ui)`: the `cn()` / tailwind-merge **type-scale fix**. tailwind-merge mistook
    our custom size tokens (`text-h2`, `text-body`, …) for text *colours* and silently dropped one
    whenever `cn()` combined a size with a colour. **App-wide behaviour change — affects everything
    built before it, including the Phase 3 checkpoint `cf4e5b8`** (e.g. `PriceTag` had no colour
    class; headings/labels rendered at inherited sizes). See DECISIONS.md.
  - **`76c1d3a`** — Phase 2 **ink amendment** (Bubble parity): ink palette (**`#34495E` single
    surface**, `ink-950/900/800/700/300` ramp; `ink-800` reclassified surface → interaction state),
    `PriceTag` + `RatingStars` ink variants, **dual focus rings** (purple on light, gold on ink),
    density pass, kitchen-sink Foundations section, SPEC §10.1/§10.2/§10.3 + DECISIONS entries.

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
**Ink amendment (this session):** the authenticated shell is now an **ink frame (sidebar + topbar)
→ white content panel → ink cards** — superseding the earlier "dark sidebar + white topbar + light
content" ruling (see DECISIONS.md). Topbar flipped light → ink; `Card`/`StatCard`/`PriceTag`/
`RatingStars` gained ink treatments; scrims → `ink-950`.
Verified: typecheck/lint/test/build green (exit 0); grep proof clean (no hex/`rgb`/`rgba`/`hsl`/
non-brand palette outside `globals.css`); kitchen sink runtime-checked at 360px & 1440px, light + ink.
Composed components (11) deferred to feature phases — see DECISIONS.md.

## Next session picks up here
1. **Rebase `phase-3-auth-onboarding-browse` (`cf4e5b8`) onto `main` at `f433430`.** It was stacked
   on the pre-amendment Phase 2, so it carries the old tokens + the `cn()` bug; the rebase pulls in
   both fixes. (This session deliberately did NOT rebase it.)
2. **Clear the deferred amendment items** (documented in DECISIONS.md → "Phase 2 ink amendment"),
   before resuming the batch:
   - **`TutorCard` restyle** to the amendment's §3 spec: `ink-900` surface, `ink-700` border, white
     name/price, `ink-300` secondary, `ink-800` subject chips, `live-400` LIVE fill with `ink-900`
     text, `ink-800` hover, `focus-ring-on-ink`.
   - **Ink `TutorCard` states** (offline/online/live) added to the kitchen sink.
   - **Browse composition:** verify it renders ink shell → white panel → ink cards.
   - **Re-evaluate the density pass against CORRECT type sizes** before assuming the tightening is
     right. The "too sparse" read that motivated it came from a render taken while `cn()` was
     suppressing font sizes — the calibration was against a broken render. **This is Daniels'
     judgement call, not an automated check.**
3. **Then resume the Phase 3 batch:** auth pages + actions (login/signup/Google/reset), onboarding
   (both roles), guards wired into the layouts, `/tutors/[slug]` + tutor profile editor, admin
   approval queue (`/admin/tutors`), `/dashboard/favourites`. (Browse path itself already built on
   `cf4e5b8`.)

## Known environment issue — CI is down (billing lock)
**GitHub Actions is locked by an account-level billing flag.** Runs #10 and #11 failed at ~2s with
**zero steps** — the runner never starts. This is **not a code failure**. Support ticket open.
Consequence right now: **CI is advisory only, and required status checks are NOT configured on
`main`** (PR #3 merged with a normal merge-commit, no override needed). **Both must be resolved
before Phase 6**, where the ungraceful-exit (`live_tutors` staleness) regression test is meant to
run in CI. Until then, local gates + runtime checks are the only signal — treat them as mandatory.
