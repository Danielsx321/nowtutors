# NowTutors — Progress (resume-from-cold)

_Read this first. Authoritative spec: `docs/SPEC.md`. Decisions log: `docs/DECISIONS.md`._

## Current state (2026-08-19)
- **Phase 0** (foundation scaffold): committed on `phase-0-foundation`, **PR #1 OPEN — not merged**.
- **Phase 1** (data layer): committed on `phase-1-data-layer` (`a31fb3f`), **PR #2 OPEN into `main` — not merged**.
- `phase-1-data-layer` is **stacked on** `phase-0-foundation`, so PR #2 includes Phase 0's commits until PR #1 merges. `main` is still at the pre-Phase-0 tip.

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

## Next up
**Phase 2 — Design system**: brand tokens (mostly wired in Phase 0), every primitive in SPEC §10.2, a `/dev/kitchen-sink` page in all states, public + authenticated layouts. Accept: kitchen sink renders at 360px & 1440px; no hardcoded hex outside the token file.
