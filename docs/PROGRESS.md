# NowTutors — Progress (resume-from-cold)

_Read this first. Authoritative spec: `docs/SPEC.md`. Decisions log: `docs/DECISIONS.md`._

## Current state (2026-08-25)

**⚠️ OPEN DEFECT, still NOT resolved: the instant request often never reaches the
tutor.** PR #47, #48 and #49 (below) each fixed something real, but the symptom
persists. Live evidence, 2026-08-25, after #49 was merged: fresh tutor page load,
`reportSubscriptionStatus` logged `SUBSCRIBED`, a student sent a request, the row was
written, and no modal appeared — nothing in the console either. Reloading the page
surfaces the request every time (the mount-time read from #49 works as designed). One
load was also observed where the subscription established and requests then flowed
live without a reload, so the fault is **inconsistent, not total** — recorded as
observed, not explained. **ELIMINATED, do not re-derive:** the row is written;
`session_requests` is in the `supabase_realtime` publication; RLS SELECT is
`((student_id = auth.uid()) OR (tutor_id = auth.uid()))`; the websocket opens; replica
identity on `session_requests` is FULL (`relreplident = 'f'`); the tutor is approved,
live and heartbeating; `IncomingRequests` is mounted; the countdown bug (#47) is fixed
and DOM-verified. **REMAINING CANDIDATES:** the server-side filter binding
(`filter: tutor_id=eq.{uuid}`), and Realtime's per-subscriber RLS authorization —
including whether the socket's JWT is actually applied, since `setAuth` is driven by
the async `INITIAL_SESSION` event while `.subscribe()` is called synchronously on
mount. This residual risk was flagged in the first investigation and has never been
ruled out. **Next step for whoever picks this up: subscribe with NO filter and log
every INSERT.** If unfiltered events arrive, the filter binding is the fault; if
nothing arrives unfiltered either, it is the authorization path. **Recoverable, not
data loss and not a money bug** — the mount-time read means a reload always surfaces
pending requests — a real UX defect that does **not** block Phase 8. See the dated
sections below for what each PR fixed and verified.

**PR #47, #48 and #49 are all MERGED to `main`.** #47 (`22a97fb`) is the countdown fix,
#48 (`8a6396b`) is the `[ir-trace]` instrumentation (removed again by #49), #49
(`7746a77`) is the subscription retry + mount-time read + tutor-facing indicator. Any
older wording in this file describing the resilience work as "not pushed, no PR"
predates all three merges.

**Phase 7 is COMPLETE — both parts MERGED — and now LIVE-VERIFIED, not only
test-proven.** Part 1 (the server half) is merged via **PR #44 (`18b0ed8`)**, with the
wire-format correction in **PR #45 (`96f251d`)**. Part 2 — the classroom UI — is merged
via **PR #46 (`1e715ac`)**. No migration in either part: `lessonspace_room_id` has
existed since `0000` (§4.3).

**Verified live, 2026-08-25, against booking `472e0ef0-e0d0-4334-9f1f-89ec8e359025`:**
student joined alone — `student_joined_at` stamped `08:40:40`, `tutor_joined_at` NULL,
`started_at` NULL, status still `confirmed` (the clock did not start with one person
present). Tutor then joined — `started_at` `08:41:49.286351`, identical to the
microsecond with `tutor_joined_at`, status flipped to `in_progress` on the same
predicate, `student_joined_at` unchanged (the shared fragment fired from a real second
arrival for the first time). The LessonSpace iframe loaded, both parties landed in the
same room, and the launch call succeeded against the real API on the first attempt —
confirming the corrected wire format (Organisation scheme, nested user object,
`client_url`). Phase 7's media half is no longer unexercised. **Still unconfirmed:**
the tutor's "end session for all" leader control did not respond to a click during this
test. Not investigated — may be a LessonSpace UI quirk or a real gap in the leader flag
reaching the tutor. Both items are also carried in "Still open — carry forward" below.

**What Part 1 shipped:** `lib/lessonspace/client.ts` (server-only, the API key
never reaches the browser), `lib/lessonspace/session-access.ts` (the access
decision and the join window, both pure), `db/queries/classroom.ts`, and
`POST /api/lessonspace/join`. The wire format is **verified**, not inferred —
checked against LessonSpace's own developer docs and the live Bubble app's API
Connector definition: `https://api.thelessonspace.com/v2/spaces/launch/` (no
`/api` segment), `Authorization: Organisation <key>`, body
`{ id, user: { name, leader } }`, and the join link field is `client_url`. The
response also carries `api_base`, `secret` and `session_id`; `secret` is a room
credential and is deliberately never returned to the browser or stored.
`LESSONSPACE_ORG_ID` (§2.1) is correctly unused — the organisation is identified
by the API key itself.

**What Part 2 shipped:** `/classroom/[bookingId]` (a Server Component, placed in
the **existing** `(session)` group beside `/session/[bookingId]` — same reason
that group exists: both roles enter, so no `requireRole` can live in the layout),
`components/features/classroom/classroom-frame.tsx` (the iframe, `allow="camera;
microphone; display-capture; fullscreen"`), `join-window-refresh.tsx`, and the
real join button on both booking detail pages. Two additions to Part 1's pure
function, and they are the load-bearing ones: a refusal **tag**
(`not_found` / `not_scheduled` / `not_joinable` / `too_early` / `too_late`) that
the UI switches on, and `joinWindowFor`, which returns the window's edges as
instants and which `withinJoinWindow` is now expressed through. **The window is
never re-derived in a page or in the browser** — one decision, rendered by the
page and enforced by the route, so an enabled button and a granted link cannot
disagree. `/session/[bookingId]` now **redirects** a scheduled booking to the
classroom (and the classroom redirects an instant booking back), and Part 3A's
"opens in Phase 7" placeholder is deleted.

**Phase 7's acceptance criterion — "both parties join the same room with correct
roles and the session status transitions properly" — is NOT fully proven, and the
split matters:**

- **Proven by tests (unit, 333 passing).** The access decision itself: a
  non-participant and a missing booking are indistinguishable; the role
  (`teacher` / `student`) and the leader flag are derived from the booking row
  and have no branch that reads a request field; the join window's two edges at
  pinned instants, inclusive on both sides; and the refusal tag the UI renders,
  including that no refusal a participant would see can borrow the 404 tag.
- **Proven by tests (integration, 36 passing, DB lane — Part 1).** The
  first-join write: `*_joined_at` stamped idempotently, `started_at` written only
  when the pair completes, `confirmed → in_progress` firing on that same
  predicate, `lessonspace_room_id` coalesced and never replaced, and the
  statement's row set disjoint from the instant path's. Breaking the shared
  fragment fails 9 of these across both paths.
- **Live-verified, 2026-08-25, against booking `472e0ef0-e0d0-4334-9f1f-89ec8e359025`
  (superseding the "not proven" note this bullet used to carry).** Two real
  participants landed in one LessonSpace room; the shared `*_joined_at`/`started_at`
  fragment fired from a genuine second arrival — student alone left `started_at` and
  `tutor_joined_at` NULL and status `confirmed`, the tutor's join stamped `started_at`
  at the same microsecond as `tutor_joined_at` and flipped status to `in_progress`;
  and the iframe rendered a live `client_url` from a real, first-attempt API call,
  confirming the corrected wire format end to end. **Still NOT confirmed:** the
  tutor actually holding working teacher controls in the room — the "end session for
  all" leader control did not respond to a click and was not investigated further.
  This one no longer needs two real browsers to check; it needs a second look at why
  the leader control didn't fire. `LESSONSPACE_API_KEY` was set for this test; it
  remains worth confirming it is also ticked for Vercel **Preview**, not just
  Production (see RUNBOOK).
- **NOT verified visually.** The 360px / 1440px pass on the new page was **not
  performed** — every classroom state is behind authentication, and reaching the
  *open* state additionally needs a booking whose window is now, which would mean
  writing to the dev project that also serves production. The layout follows the
  §10 tokens and the `/session` page's panel shapes; it has not been looked at in
  a browser. Worth ten minutes with a seeded login before merge.

**The one thing a cold session must not re-derive: `stampSessionJoin` could not
be reused for the scheduled path.** Its WHERE is `status = 'in_progress'` and
scheduled bookings are created `confirmed`, so the first joiner matched zero
rows; it also never writes `status` and backfills `agora_channel`. Rather than
fork it, the `*_joined_at` / `started_at` rule was extracted into **one shared
SQL fragment, `db/queries/join-stamp.ts`**, imported by both join statements —
the completion cron reads `started_at` and two writers of it drift. The shipped
instant statement was deliberately **not** parametrized to take a status write.
Breaking the shared fragment fails 9 integration tests across both paths; the
unit lane has no database and cannot see it. **Part 2 did not touch that
fragment or either statement that imports it.** See `DECISIONS.md`, "Phase 7
Part 1" and "Phase 7 Part 2", and SPEC §7.7's two implementation notes.

**Phase 6 Part 3B — the server-side end, the elapsed hard stop, and the §9
control-bar remainder — is COMPLETE**, merged via **PR #34 (`0bb9be2`)** and
**PR #35 (`974cd7a`)**. #34 shipped the server-side end and the hard stop; #35
closed the carve-out #34 deliberately left out — the §9 `toggleMic`/`toggleCamera`
control-bar toggles and the 80%-margin token renewal, scheduled off the token
route's `expiresAt`. **~~The §9 control-bar toggles (mic/camera/screen share),
chat, credits consumed/earned and the 80%-TTL token renewal are not in it and are
still absent rather than stubbed~~ — DONE for mic/camera toggles and token
renewal in PR #35.** Screen share and chat remain absent rather than stubbed —
still no part of any merged pass. Neither PR needed a migration — `ended_at` and
`billed_minutes` have existed since `0000`. See "What Phase 6 Part 3B built"
below, and `DECISIONS.md` for the three SPEC amendments #34 carries (§4.3
`billed_minutes`, §12 `complete-sessions`, §9 step 2), the falsification table,
and #35's renewal-off-`expiresAt` reasoning.

**Phase 6 Part 3C — the complete-sessions cron and `tutor_earnings` — is
MERGED**, via **PR #39 (`8c06dbe`)**, squashed from
`phase-6-part3c-complete-sessions`. A review pass on the open PR found one real
defect and one overclaim before merge — both fixed in the same squashed commit,
not a follow-up: `row.priceCredits ?? 0` would have written a zero-credit
`tutor_earnings` row for a NULL-price booking, permanently occupying that
booking's UNIQUE `booking_id` slot; it now skips the row, logs the booking id,
and counts it in a new `earningsSkippedNoPriceIds` / `earningsSkippedNoPrice`
field. The doc comments and DECISIONS also overclaimed "`lib/credits/ledger.ts`
is not imported, transitively or otherwise" — false, since `db/queries/
sessions.ts` imports `sessionChannel` from `lib/session-requests/accept.ts`,
which value-imports `debitWallet` (pre-existing from Part 3B); corrected to the
checkable claim, that this path calls nothing from the ledger and writes no
wallet, while the module IS in the import graph. It needed **no migration**:
`tutor_earnings` has existed since `drizzle/0000` with exactly the columns it
writes, `booking_id` already carried its UNIQUE, and `no_show_tutor` /
`no_show_student` were already values in the shipped `booking_status` enum. See
"What Phase 6 Part 3C built" below. Two SPEC amendments ride with it (§7.11's
no-show money rules and wallet-at-release; §12's clock for a never-started
instant booking, which was named as this cron's job without anything saying what
made it due), plus a falsification table in `DECISIONS.md` — including the break
that proved nothing until the fixtures were fixed.

**PR #40 is MERGED** (`2f398d3`), squashed from `docs/schedule-complete-sessions-cron`: the
`pg_cron` snippet and the RUNBOOK scheduling step, docs-only — no code, route, or test changes.
`drizzle/snippets/pg_cron_complete_sessions.sql` follows the `expire-requests` snippet's shape
exactly — same extensions, same two Vault secrets, reused rather than re-created — scheduling
`*/15 * * * *` (§12).

**`complete-sessions` is now SCHEDULED AND VERIFIED LIVE, 2026-08-25** — the first cron in the
deployed app proven working end to end, not just scheduled. The snippet has run against
`mipnoxlhurdbaahmvhhx`: `cron.job` shows `complete-sessions` (`jobid` 2) at `*/15 * * * *`,
`active = true`, alongside `sweep-presence` (`jobid` 1). A manual `pg_net` invocation returned
**200** with `{"ok":true,"job":"complete-sessions","completed":0,"noShowTutor":0,
"noShowStudent":0,"earningsCreated":0,"earningsSkippedNoPrice":0,…}` — read from
`net._http_response` by request id, since `net.http_post` itself returns only a request id, never a
status code (see RUNBOOK's rotation-trap and Vault-dependency notes on this item). Now that it's
scheduled, `complete-sessions` closes the both-parties-offline case and every no-show without
needing a person present — the four Part 3B server-side actors were always sufficient while someone
was in the room; this cron is what covers everyone else.

**`CRON_SECRET` rotation is CLOSED, twice over.** The original 2026-08-23 rotation (exposed via
terminal/store-pasting during initial setup) closed the gate that had blocked scheduling in the
first place. A **second** rotation happened 2026-08-25, after the value was pasted in plaintext
into a chat session during this work — same exposure mode, different trigger. Both directions were
verified live rather than assumed: the specific chat-exposed value now returns **401**
(`Authorization: Bearer <that value>`), confirming it's dead; an unauthenticated GET also returns
401, confirming the guard itself is still active; and the scheduled `complete-sessions` job's most
recent response is **200**, which is only possible if the Vault's current secret matches what the
deployed app checks against. No value, old or new, is recorded anywhere in the repository.

**All three built crons are now SCHEDULED AND VERIFIED LIVE on `mipnoxlhurdbaahmvhhx`, 2026-08-25.**
`cron.job` holds all three, all `active = true`:

| Job | Schedule | `net._http_response` |
|---|---|---|
| `sweep-presence` | `*/5 * * * *` | 200, `{"ok":true,"job":"sweep-presence","swept":0,…}` |
| `complete-sessions` | `*/15 * * * *` | 200, `{"ok":true,"job":"complete-sessions","completed":0,…}` |
| `expire-requests` | `* * * * *` | 200, `{"ok":true,"job":"expire-requests","expired":0,…}` |

Three things worth recording beyond the table:

- **`expire-requests` was observed firing on consecutive minutes** — four rows in
  `net._http_response`, `01:56:00Z` through `01:59:00Z`, each 200. That's what confirms the
  schedule is actually *running*, not merely *registered*: `cron.job.active = true` plus one manual
  invocation would look identical for a job that has never once fired on its own clock.
- **`sweep-presence` returning 200 is the FIRST captured evidence that it works**, not a
  re-confirmation. It has been scheduled since Phase 6 Part 1 with nothing beyond a generic "200
  with `{"ok":true,…}`" ever recorded against it — the actual response body was never captured
  until this session. "It's been running since Phase 6 Part 1" had quietly become an assumption,
  not a verified fact; see `docs/RUNBOOK.md`'s sweep-presence item for the correction.
- **Zeros in every count are the correct result, not a weak one.** The deployed data has no live
  tutors, no pending requests, and no in-progress bookings past their deadline — so `swept: 0`,
  `expired: 0`, and `completed: 0` are exactly what should come back. A zero proves the *pipe*
  (route reached, guard passed, response captured, logged correctly) rather than the *sweep logic*,
  which is what the DB-backed and unit test suites prove instead. See `docs/RUNBOOK.md` for the
  full verification queries, including the rotation-trap and Vault-dependency notes on the
  `complete-sessions` item, which apply to all three.

**A fresh environment will need all three snippets run again.** `cron.job` and the Vault secrets
are per-project state — nothing about them travels when `NEXT_PUBLIC_SUPABASE_URL` and friends get
repointed at a real production project (the launch-blocker item). `pg_cron_sweep_presence.sql`
must run first there too, since it creates the extensions and the two Vault secrets
(`app_base_url`, `cron_secret`) the other two snippets read by name rather than create.

**Repo hygiene held through three real phase merges this session.** PR #39 (feature), PR #40
(docs), and PR #41 (docs) all squash-merged cleanly; `git fetch --prune` + a content-identity check
(`git diff main <branch> --stat` empty) before each `-D` confirmed no work was lost before deleting
the local branch. `origin` and the local checkout both hold `main` only — no stray branches, no
divergence.

Screen share, chat and credits-consumed/earned remain the open Part 3 remainder;
`release-earnings` and withdrawals are Phase 8.

**PRs #32 and #33 are MERGED** (`df9d249`, `582e83a`). #32 was squash-merged while
#33 still carried #32's original commit, which left #33 `CONFLICTING` against
`main`; it was rebased (`--onto origin/main`, dropping the duplicate) and
force-pushed, and the rebased tree was verified byte-identical to the one CI had
already passed. **If Part 3C stacks on Part 3B, the same rebase will be needed —
or land the lower PR with a merge commit instead of a squash.**

**Four PRs merged earlier this session: #27 (CI build gate), #28 (Bubble live-app investigation), #29
(Phase 6 Part 3A — session room), #30 (student `/dashboard` fix).** See their own sections below for
detail; `DECISIONS.md` and `SPEC.md` are already current for #28 (no further doc changes needed
there).

**Phase 6 Part 3A — the session room shell and the Agora join — is COMPLETE and merged via PR #29
(`4141d4a`).** See "What Phase 6 Part 3A built" below. It needed **no migration**: `0014` already
carried `agora_channel`, `started_at`, `student_joined_at` and `tutor_joined_at`. Two things in the
build brief were **overridden after escalation** and both matter — the student now receives a
`publisher` token rather than a `subscriber` one, and `started_at` is set when **both** parties are
present rather than on first arrival (a billing bug if built as briefed). Both are in `DECISIONS.md`
under "Phase 6 Part 3A".

**✅ The gap that was blocking Phase 6 Part 3B is CLOSED.** Part 3A's `started_at` concurrency
properties now have automated coverage: `tests/integration/session-join-concurrency.test.ts`, run by
**`pnpm test:db:test`** against the disposable test project, drives the shipped `stampSessionJoin` on
**two real connections in two real transactions** and asserts all four properties — the second
stamp's moment is what `started_at` records (not the first's), a genuine row-lock race writes it
exactly once with neither `*_joined_at` pushed back to null, a lone participant never starts the
clock, and re-stamping after the fact moves nothing. **The suite was proved capable of failing**: the
`UPDATE` was temporarily rewritten into the CTE form (DECISIONS, Part 3A item 3), exactly the
concurrent test failed with the predicted damage, and the shipped version was restored green. No
shipped behaviour changed. **The lane is deliberately NOT in CI** — the runner has no Postgres and no
`.env.test`, so adding it would fail the required `verify` check for missing infrastructure rather
than for a broken assertion. `pnpm test` (the DB-free unit lane) is unaffected: 244 tests, 21 files,
still green, and its `tests/unit/**` glob cannot pick these files up. See "Phase 6 Part 3A — shipped
state" below and DECISIONS, "Phase 6 Part 3A — `started_at` concurrency coverage".

**Part 3B is unblocked, and the timestamptz defect PR #32 recorded is now FIXED** (2026-08-24,
`fix/join-stamp-timestamptz`, stacked on #32). PR #32's read-only verification had marked the
*runtime* half of that claim UNCLEAR — it rested on one probe and the test's normaliser accepted
both shapes, so the green suite did not discriminate. It was re-probed on the **production path**
(the real `@/db` singleton, unmocked) before anything was changed, and confirmed: all three of
`studentJoinedAt` / `tutorJoinedAt` / `startedAt` came back `typeof=string`, e.g.
`2026-08-24 11:18:57.085553+00`, with `typeof startedAt.getTime === "undefined"`. The control is
what bounds it — raw `execute()` yields text on **both** poolers, while the query builder and
`.returning()` decode the same column into a real `Date`. So the defect was specific to raw
`execute()`, and `stampSessionJoin` held the only one in all of `src/`.

**Fixed at the query boundary** (`toDate` in `db/queries/sessions.ts`), not by widening `JoinStamp`
to `Date | string` — that would push a billing-critical coercion onto every future consumer and
Part 3B would inherit it. **This changes a shipped return type's runtime value: Part 3B reads
`startedAt` and now gets a real `Date`.** The `UPDATE` statement is byte-identical to what #29
shipped and #32 tested, so the both-parties gating and the no-CTE property are untouched.

**Why it stayed latent through Part 3A review:** `/api/agora/token` reads `stamp.agoraChannel` and
nothing else — `agora_channel` is `text`, so it is a string by nature and correct either way. The
one field the only consumer touches is the one field that was never wrong; the three that were wrong
had no reader at all.

**What remains unverified is the Agora media path, not the SQL**: two live participants in one
channel still needs two authenticated browsers and real devices, and that is a §15 E2E concern
rather than a Part 3B blocker. **The same is now true of PR #35's toggle/renewal path** — the
`toggleMic`/`toggleCamera` control-bar wiring and the 80%-margin token renewal are unexercised
against a live Agora channel for the same reason: no automated pass drives two real browsers.
Also a §15 E2E concern, explicitly non-blocking for Part 3C.

**Phases 0–5, Phase 6 Part 1, and Phase 6 Part 2 are complete and merged to `main`.** Phase 6
Part 2 — the instant-session handshake, its billing and the expiry cron — was **merged via
PR #22 (`2d792de`)**; see "What Phase 6 Part 2 built" below. It needed **no migration**: Part 1's
`0014` already carried every column and enum value it writes. Earlier that day two pieces of
**infrastructure** Part 1 had left open were closed — a disposable test database, and the presence
sweep actually being scheduled. See "2026-08-23 — test project, tooling, and the cron going live"
below.

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
- **Browse restyle** — ink shell + site-wide full-bleed layout (PR #7, `0489add`). Merged.
- **Phase 4 Part 1 — availability slot computation** — the pure, DB-independent `computeSlots()`
  (`src/lib/availability/compute-slots.ts`) + 13 Vitest cases (DST both sides, cross-tz rendering,
  exception overrides, back-to-back bookings, notice/horizon cutoffs), plus the
  `platform-settings-defaults` extraction so seed and tests share one source of truth. The Phase 1
  migration already carried the `availability_rules`/`availability_exceptions` tables, so no new
  migration. SPEC §4.2 pins the slot-grid semantics. **Merged via PR #8 (`4fed575`).**
- **Phase 4 Part 2 — scheduled booking flow (credits only)** — the ledger (`lib/credits/ledger.ts`),
  the booking-creation action with server-side slot re-validation + price re-derivation + atomic
  debit, both sides' booking list/detail pages, and the availability editor. Out of scope:
  cancellation/refunds, PayPal, LessonSpace, instant sessions. **Merged via PR #9 (`03f33a5`).**
- **Phase 5 Part 1 — PayPal orders, capture, webhook, credit packages** — the PayPal client
  (`lib/paypal/client.ts`), credit-package lookup (`lib/credits/packages.ts`), and the three
  money-path endpoints (`POST /api/paypal/orders`, `POST /api/paypal/orders/[orderId]/capture`,
  `POST /api/webhooks/paypal`) built on `lib/paypal/settlement.ts`, which client capture and the
  webhook both call so a race between the two is a no-op via the ledger's `(type, reference_id)`
  unique index. **Merged via PR #10.** SPEC §7.6 and `DECISIONS.md` gained Part 1 sections in the
  same commit.
- **Phase 5 Part 2 — wallet, booking direct-pay, admin payments** — `/dashboard/wallet` (balance,
  buy credits, paginated ledger history), **booking direct-pay** (`POST /api/paypal/orders` now
  takes `{ purpose: 'booking', bookingId }` as well), and `/admin/payments` reconciliation. Plus a
  hardening fix: `PayPalConfigError` now returns **503** at the route-adapter boundary of all three
  PayPal routes instead of escaping as an uncaught 500 (observed in production 2026-08-22).
  **Direct-pay is buy-then-spend in one checkout** — a booking has no USD price of its own, so the
  order mints exactly the credits the booking costs and settlement immediately spends them
  (`purchase` + `booking_debit`, net zero), then flips the booking to `confirmed`. USD comes from
  the one `credit_packages` tier flagged `is_direct_pay_basis`; zero or two flagged **throws**
  rather than mis-charging. Migration `0013` adds `pending_payment` to `bookings_no_overlap`, and a
  `pending_payment` booking older than **20 minutes** stops blocking a slot on read (§4.2), so the
  §12 expire-unpaid cron is tidy-up rather than correctness (still not built — see "Still open"
  below). SPEC §4.2/§4.3/§4.4/§7.3 and §7.6 (now a Part 1+2 note) updated alongside the code;
  `DECISIONS.md` gained a Part 2 section. **Acceptance is sandbox only** — real-card testing is
  deferred to **Phase 10**, along with live webhook registration.
  **Same-PR fix — a captured direct-pay is always honoured.** Settlement originally minted and
  debited before confirming the booking; if the §12 sweep had already expired the
  `pending_payment` hold, the debit and mint both committed, the confirm no-opped, and the student
  was charged with no credits and no booking (the webhook still answered 200, so PayPal never
  retried — a silently lost payment). Fixed by reordering to **mint → confirm → debit**, gating the
  debit on the confirm succeeding: if the slot is gone the debit is skipped and the student keeps
  the minted credits (the only outcome needing no refund, and SPEC has none). New result status
  `booking_unavailable_credits_retained`; the replay guard now reads both ledger legs
  (`PaymentStore.settledLegs`) instead of inferring one from the other, since a committed mint can
  now legitimately stand with no debit beside it. `/admin/payments` flags this state outright.
  **Same-PR follow-up — the retained-credit label is derived at read time, not written.** An initial
  version amended the mint's ledger `description` after the confirm failed, via a narrow `UPDATE`
  (`describeTransaction`). Rejected before merge: §4.4's append-only rule is worth more as an
  absolute than any one row's wording. Replaced with `lib/credits/retained-credits.ts`, a pure
  read-time derivation (`purchase` + payment `purpose = 'booking'` + no matching `booking_debit`)
  consumed by `db/queries/wallet.ts`; `credit_transactions` reverted to INSERT-only, with the
  in-memory ledger fake now freezing rows and throwing on any attempted rewrite so the invariant
  fails loudly in tests if ever reintroduced. **Merged via PR #13 (`003b992`).**
- **Phase 6 Part 1 — presence + migration `0014`.** **Merged via PR #16 (`7b84841`).** See "What
  Phase 6 Part 1 built" below. PROGRESS was brought to true state for it in **PR #17 (`45511bd`)**.
- **Phase 6 Part 2 — session-request handshake + billing.** **Merged via PR #22 (`2d792de`).**
  See "What Phase 6 Part 2 built" below.
- **Test project + tooling + cron scheduling (2026-08-23)** — **PR #18 (`eafe863`)**,
  **PR #19 (`b50b14f`)**, **PR #20 (`4b19bd6`)**. Infrastructure only, no product code. See the
  next section.
- **Phase 6 Part 3A — session room shell + Agora join.** **Merged via PR #29 (`4141d4a`).** See
  "What Phase 6 Part 3A built" below.
- **Bubble live-app investigation — four read-only passes, two findings, six decisions.**
  **Merged via PR #28 (`0955801`).** See "Bubble live-app investigation" below; full detail already
  lives in `DECISIONS.md` (same section title) and is not restated here.
- **Student `/dashboard` fix — same defect class as the earlier tutor `/tutor` fix.**
  **Merged via PR #30 (`7afea77`).** See "Student `/dashboard` fix" below.
- **DB-backed `stampSessionJoin` concurrency coverage.** **Merged via PR #32 (`df9d249`)**
  — `tests/integration/`, `pnpm test:db:test`, the `TEST_PROJECT_REF` guard. See "What Phase 6
  Part 3A built" below and DECISIONS, "Phase 6 Part 3A — `started_at` concurrency coverage".
- **`stampSessionJoin` returns real `Date`s, not timestamp text.** **Merged via PR #33
  (`582e83a`)** — fixed at the query boundary (`toDate`); the `db.execute` generic corrected to
  `string | Date | null`. See the top of this file and DECISIONS, "`stampSessionJoin`'s
  timestamps — probed, then fixed at the boundary".
- **Phase 6 Part 3B — server-side end + elapsed hard stop.** **Merged via PR #34 (`0bb9be2`).**
  See "What Phase 6 Part 3B built" below.
- **Phase 6 Part 3B remainder — control-bar mic/camera toggles + Agora token renewal.**
  **Merged via PR #35 (`974cd7a`).** See "What Phase 6 Part 3B built" below and DECISIONS,
  "Phase 6 Part 3B remainder — control-bar toggles + token renewal".
- **Phase 7 Part 1 — LessonSpace server half.** **Merged via PR #44 (`18b0ed8`)**, with the
  wire-format correction in **PR #45 (`96f251d`)**. See the top of this file and DECISIONS,
  "Phase 7 Part 1".
- **Phase 7 Part 2 — the classroom UI.** **BUILT, not merged, not pushed**
  (`feat/phase7-part2-classroom`). See the top of this file and DECISIONS, "Phase 7 Part 2".

## 2026-08-25 — the instant request never reached the tutor: the SUBSCRIPTION never established (`fix/realtime-subscription-resilience`)

**Branched off `main` at `8a6396b` (PR #48, the `[ir-trace]` instrumentation). One
commit. NOT pushed, no PR.** This is the sequel to the countdown fix below, and the
instrumentation from #48 is removed in this same commit — grep `ir-trace` returns
nothing in `src/`.

**What the instrumentation settled, so it is never re-derived.** When the channel
reaches `SUBSCRIBED` the **entire** chain works — verified live: request sent, INSERT
callback fired, `getIncomingRequest` resolved, queue populated, modal painted. The
countdown fix was necessary for that and is correct. The fault is one step earlier:
`.subscribe()`'s callback resolved `TIMED_OUT` on some page loads and **never fired at
all** on others, across three tutor accounts and three browsers — and **nothing
retried**. A failed subscribe was permanent for that page's lifetime and invisible: the
tutor still showed as live and simply never received anything.

**Why it fails, and it is not a code property.** Supabase shuts a project's Realtime
tenant down on the free tier when nobody is connected (*"Stop tenant because of no
connected users"*), and the cold start — replication slot, publication validation,
partition creation — outlasts the client's connect timeout. **The first tutor to open
`/tutor` after a quiet period is the one who loses**, which is why it read as
intermittent. Like the `pg_cron`/Vault state, this is **per-project** and does not
travel: the Phase 10 production project will start with a cold tenant and no cron, and
will present this same symptom on its first tutor login. See DECISIONS for the full
entry, and RUNBOOK for the operational note.

**Three things built:**
1. **The subscription retries** (`useRetryingChannel`, used by BOTH sides of the
   handshake). Bounded exponential backoff, 1s → 30s cap, no attempt limit; the previous
   channel is removed **before** the backoff so repeated failure costs one socket, not
   many; a **15s watchdog** treats a status callback that never fires as a failure,
   because a retry hung off that callback alone cannot see a connect that hangs; `CLOSED`
   is never retried and an unmount mid-backoff cancels the pending retry. This **reverses**
   the "visibility only, no retry" decision recorded below — it is not polling: it asks for
   no data, runs only while the channel is down, and stops when it is up.
2. **A mount-time read.** `getPendingRequestsForTutor` (query layer) →
   `listPendingIncomingRequests` (guarded action) → read on mount **and** after each
   successful (re)subscribe, merged into the queue by id. On mount covers "the channel
   never establishes"; after subscribe covers "the request arrived while it was down".
3. **The tutor is told.** `RealtimeStatusIndicator` in the `(tutor)` shell, shown **only**
   after an attempt has failed — never during the first connect — and clearing itself when
   a retry succeeds. §10 tokens only: `ink-900` fill, `ink-700` border, white/`ink-300`
   text, `warning` amber dot (4.55:1 on ink, past the 3:1 non-text floor).

**Also fixed:** the `(tutor)` layout guard and `getIncomingRequest` disagreed about
approval, so a mounted-but-unapproved tutor's every enrichment threw `NEXT_REDIRECT` into
a fire-and-forget — an invisible unhandled rejection. Both reads now pass
`{ requireApproval: false }`, matching the layout; accept/decline keep approval enforced.
`reportSubscriptionStatus` now logs `SUBSCRIBED` too, because a console with no
`[realtime/…]` line meant either "healthy" or "the callback never ran".

**Tests: 24 DOM (up from 11), 3 files.** `tests/dom/realtime-resilience.test.tsx` is new
and its fake channel is deliberately **inert** — it records the status callback instead of
calling it, so "the callback never fires" is a state a test can actually reach.
`incoming-requests.test.tsx`'s fake now reports `SUBSCRIBED`, as a healthy client does.
**Four breaks, all four caught:** `TIMED_OUT` non-retryable → 3 failures (including
*Unable to find an accessible element with the role "status"*); watchdog removed → 1;
mount-time read removed → 3 (including *…role "dialog"* — the production symptom
reproduced); `dropChannel()` removed from the failure path while the retry still works →
1, which is the one worth keeping, since a test asserting only "it reconnected" would have
missed the leak.

**Gates (all local, this machine):** `pnpm typecheck` clean, `pnpm lint` clean,
`pnpm build` exit 0, `pnpm test` 28 files / **333 passed**, `pnpm test:dom` 3 files /
**24 passed**. `pnpm test:db:test` and `pnpm db:verify-rls` were **not** run — no schema,
RLS policy or SQL-enforced rule changed, and the new read is a plain SELECT on existing
indexes.

**NOT closed by this:** the tutor-in-a-session mount gap (below, first carry-forward item)
is untouched — `IncomingRequests` still mounts in `(tutor)` while the heartbeat mounts in
`AppShell`. And **the live re-test is still owed**: everything above is asserted in jsdom
against a fake socket. Nobody has yet watched a real tutor page recover from a real cold
tenant.

## 2026-08-25 — the tutor's modal never painted (`fix/incoming-requests-never-shown`)

**Branched off `main` at `1e715ac` (PR #46, Phase 7 Part 2 merged — the "BUILT, not
merged" note above and at the top of this file predates that merge and is stale).
One commit. NOT pushed, no PR.**

**The symptom.** A live tutor on a tutor page never saw an incoming instant
request. The student's ring ran the full sixty seconds and the request expired
unanswered. Nothing logged, nothing threw, 333 tests green.

**The cause, deterministic and present since `2d792de`.** In `use-countdown.ts`
`secondsLeft` was `useState` seeded from an **effect** while `deadline` was a
`useMemo`. On the render where `expiresAt` first became non-null, `deadline` was
already real and `secondsLeft` was still the previous `0`, so
`elapsed = deadline != null && secondsLeft <= 0` was **true on a countdown at
sixty**. The effect at `incoming-requests.tsx:86` dropped the request in the
same flush that seeded the number, the queue emptied, and the component returned
`null` before anything reached the screen. Not a race — it happened every time.

**The fix is in the hook.** `secondsLeft` is now derived during render
(`read()`, the clock against *this* render's deadline) and the interval only
forces a re-render. There is no stored countdown left to be stale, so a
freshly-set deadline cannot report itself elapsed — by construction, for all
four consumers. Deliberately NOT patched at the call site: `SessionTimer` and
the student's waiting ring read `elapsed` on the same render and carried the
same latent fault. See DECISIONS, "The tutor's modal never painted".

**A DOM test lane now exists — `tests/dom/`, `vitest.dom.config.ts`,
`pnpm test:dom`, and it IS a CI step.** No component in this repo had ever been
rendered by a test; the unit lane is `environment: "node"`. That is why 333
green tests said nothing. New dev dependencies (SPEC §2, same commit): `jsdom`,
`@testing-library/react`, `@testing-library/dom`. The node lane is untouched and
still 28 files / 333 tests — separate config, disjoint glob, disjoint extension.
11 DOM tests; with the old hook restored, 5 of them fail and the tutor test
fails with "Unable to find an accessible element with the role `dialog`", which
is the production symptom reproduced.

**One DOM-lane failure was seen once and never reproduced** (2 failed / 9 passed,
on a sweep where the machine was starved — `environment 65.73s` against a normal
3.8s). 12+ runs since, including two with every core saturated, are 11/11, and
the failing run's output was not captured. The lane's `testTimeout`/`hookTimeout`
are now 30s (the tests pin the clock, so what a slow machine threatens is the
default 5s budget, not the numbers). Do not treat this as closed — **if it
recurs, capture the runner's output first.** See DECISIONS, item 3b.

**Realtime subscription failures are now logged** (`reportSubscriptionStatus`,
both sides). Visibility only — no retry, no behaviour change.

**Three defects found in this pass and deliberately NOT fixed here** — each
needs a decision this fix had no business taking. All three are in "Still open —
carry forward" below with what would have to be decided.

## 2026-08-23 — test project, tooling, and the cron going live

Three merged PRs, no application code. Each closed something Phase 6 Part 1 had listed as open.

**Disposable test Supabase project — `nowtutors-test`, ref `uietkphpfqaicbndunwt` (eu-west-3).**
Scaffolded in **PR #18** (`.env.test.example` + gitignore), wired in **PR #19**. Credentials live in
`.env.test` (gitignored). This is the first database on the project that is *not* shared with
production, which is what unblocks seeding for E2E.

- **Targeting is dedicated script variants, not a flag.** Every db script has a `:test` twin —
  `db:migrate:test`, `db:generate:test`, `db:reset:test`, `db:seed:test`, `db:verify-rls:test` —
  that loads `.env.test` instead of `.env.local`. `drizzle-kit` scripts pass
  `--config=drizzle.config.test.ts`; `tsx` scripts require an explicit `--env=dev|test` argument
  supplied by the pnpm script itself, and **throw** if it is missing rather than defaulting. A plain
  `pnpm db:migrate` cannot reach the test project and a `:test` command cannot reach dev.
- **The safety guard compares against a hardcoded literal.** `TEST_PROJECT_REF` in
  `src/db/load-env.ts` holds the ref as a string constant; every `:test` script aborts before doing
  anything if the resolved connection string does not contain it. It deliberately does **not** read
  an env var — see DECISIONS, "a guard you can disable by forgetting to set a variable is not a
  guard". `tests/unit/load-env.test.ts` covers pass, mismatch, and the no-env-var-dependency case.
- **The 0000→0014 chain was proven clean on an empty database for the first time.**
  `pnpm db:migrate:test` applied all 15 migrations from nothing — **25 tables** in `public`, no
  errors (only benign `DROP TRIGGER IF EXISTS … skipping` NOTICEs where later migrations drop
  triggers that a from-scratch run has not created yet). This had never been exercised end to end:
  every prior migration ran incrementally against a database that already had history. It matters
  beyond testing — **the Phase 10 production Supabase swap runs this same chain against an empty
  project**, so this is the first evidence that it works.
- **Seeded, with counts verified by direct DB query rather than the seed script's own log.**
  11 profiles (1 admin, 8 tutors, 2 students), 8 `tutor_profiles`, 26 subjects, 9
  `platform_settings`, 2 favourites — read back out of the database, because a script reporting its
  own success proves only that it reached the end.
- **No cron on the test project, and it needs none** (RUNBOOK). It exists for seeding and E2E, which
  drive presence explicitly; the sweep is tidy-up, not correctness. A second job here would also
  POST at the production URL.

**`scripts/with-ca-certs.mjs` — the `NODE_EXTRA_CA_CERTS` prefix is now automatic (PR #19).**
Every `db:*` and `db:*:test` script runs through a wrapper that sets
`NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem` when the variable is unset and that file exists, and is a
silent no-op otherwise. It never disables TLS verification.

- *Why it cannot live in `src/db/load-env.ts`.* **`NODE_EXTRA_CA_CERTS` is read by Node once at
  process startup, before any application code runs.** Setting `process.env.NODE_EXTRA_CA_CERTS`
  from inside the running script has no effect on that process's already-initialised TLS store — it
  has to be set *before* the `tsx`/`drizzle-kit` process is spawned, which is why the fix is a
  wrapper that spawns a child rather than a line in the env loader.
- *Why it was worth automating.* Forgetting the prefix produces
  `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, which reads like a credentials or network failure. It cost a
  wrong diagnosis in this very session: the first `db:seed:test` run failed that way and was
  initially reported as possibly-missing credentials, when the credentials were fine and Node's CA
  bundle was the problem. `curl` to the same host succeeded throughout.
- The manual `export` survives in RUNBOOK only as the fallback for machines whose system CA bundle
  is at a different path; an already-set value is left untouched.

**`sweep-presence` is scheduled and verified (PR #20).** Supabase **pg_cron + pg_net** on the shared
dev/prod project `mipnoxlhurdbaahmvhhx`, `*/5 * * * *` per SPEC §12.

- **Why pg_cron and not `vercel.json`:** the deploy target is Vercel **Hobby**, whose crons fire at
  most **once a day** — useless for a 5-minute sweep. There is deliberately no `vercel.json`.
- **Verified:** job active in `cron.job` (`jobid` 1, `*/5 * * * *`); a manual `net.http_post`
  invocation returned **200** with `{"ok":true,…}`, confirming the Vault `cron_secret` and Vercel's
  `CRON_SECRET` agree. A 401 would have meant they disagree; a 503 that the deployment has no secret.
- **The job body reads both secrets from `vault.decrypted_secrets` at call time and never inlines
  them** — `cron.job.command` is readable by anyone with database access, so a literal token there
  would expose the only thing guarding a write endpoint.
- Run by hand from the Supabase SQL editor as `postgres`: `create extension` and the Vault writes
  need privileges the migration connection does not have, which is why
  `drizzle/snippets/pg_cron_sweep_presence.sql` is deliberately not a migration.


## What Phase 7 built (`feat/phase7-part1-lessonspace-join` + `feat/phase7-part2-classroom`)

**Part 1 — the server half (merged, PR #44 / #45).**

- `src/lib/lessonspace/client.ts` — `server-only`. One call, `POST
  https://api.thelessonspace.com/v2/spaces/launch/`, which does create-or-get
  **and** the per-user link in one round trip (`spaces/launch/` is idempotent on
  the `id` we send, which is the booking id). Returns `{ roomId, clientUrl }`;
  `secret` is parsed past deliberately.
- `src/lib/lessonspace/session-access.ts` — pure. Participation first and
  unconditionally, then type, then state, then the join window
  `[start − 10m, end + 30m]`, inclusive at both edges, with `now` an explicit
  parameter.
- `src/db/queries/classroom.ts` — the read, and `stampScheduledSessionJoin`: one
  `UPDATE`, no CTE, `lessonspace_room_id` coalesced, `confirmed → in_progress` on
  the same predicate that writes `started_at`, scoped `type = 'scheduled'`.
- `src/db/queries/join-stamp.ts` — the `started_at` rule as **one** exported SQL
  fragment, imported by both join statements.
- `POST /api/lessonspace/join` — the only way a browser gets a link. Body is
  `{ bookingId }` and nothing else; identity, role, leader flag and display name
  are all server-derived. Launch happens **before** the stamp.

**Part 2 — the UI (built, not merged).**

- `src/app/(session)/classroom/[bookingId]/page.tsx` — Server Component, in the
  **existing** `(session)` group. Four states, all switched off the shared
  decision's refusal tag: the room, "isn't open yet" (with the opening time in
  the viewer's timezone and a countdown under an hour), "has closed", and "no
  classroom to join". `not_found` → `notFound()`; `not_scheduled` → redirect to
  `/session/[bookingId]`.
- `src/components/features/classroom/classroom-frame.tsx` — `"use client"`.
  POSTs the booking id to the join route on mount and renders the returned
  `client_url` in an `<iframe allow="camera; microphone; display-capture;
  fullscreen">`. Never calls LessonSpace. One request per mount; a failure
  surfaces a "Try again" button, not a retry loop.
- `src/components/features/classroom/join-window-refresh.tsx` — one `setTimeout`
  → one `router.refresh()` at a window edge, plus the cosmetic countdown. No
  interval, no network call, no decision.
- `booking-detail-view.tsx` — the Phase 4 placeholder button replaced with the
  real one, driven by the same `checkLessonSpaceAccess` call. Both booking
  detail pages now pass `viewerId`.
- `/session/[bookingId]` — redirects a scheduled booking to the classroom; the
  Part 3A placeholder is deleted.

**What Phase 7 does NOT include:** tutor-only controls as page logic (they come
from the `teacher` role in the launch payload, §7.7), the LessonSpace waiting
room (a dashboard setting, in the runbook), and any call ever actually made to
LessonSpace — `LESSONSPACE_API_KEY` is unset locally, so the whole third-party
path is unexercised.

## What Phase 6 Part 3C built (`phase-6-part3c-complete-sessions`)

**The sweep that closes sessions nobody was left to close, and the first
`tutor_earnings` writer in the codebase.** `GET/POST /api/cron/complete-sessions`
(`*/15`), following `expire-requests` exactly: `cronAuthFailure` first, nodejs
runtime, `force-dynamic`, structured `console.info` summary, 500 on throw, POST =
GET. Returns `{ ok, job, completed, noShowTutor, noShowStudent, earningsCreated,
durationMs }` plus the affected booking ids per classification.

**No migration, no RLS change, nothing under `drizzle/`, and nothing from
`lib/credits/ledger.ts` — not even transitively.**

- **Three work sets, three clocks.** *Instant, started:* the shared
  `sessionElapsedSql` fragment, **called and not restated**, closed through the
  shipped `endElapsedInstantSession` one booking at a time so the `ended_at` cap
  is not copied. *Instant, never started:* `created_at + duration_minutes <=
  now()` with `started_at IS NULL` in the predicate — the clock §12 never stated,
  decided this pass and written into §12. *Scheduled:* `scheduled_end_at + 30m`,
  `confirmed` or `in_progress`, `ended_at = scheduled_end_at`.
- **Classification from `started_at` / `*_joined_at`, tutor-absence first**, in
  one shared SQL fragment used by both statements. Both-NULL lands
  `no_show_tutor`: an empty room is not evidence the tutor was there.
- **The money rules, decided this pass and recorded in `DECISIONS.md`:**
  `completed` and `no_show_student` each write a `tutor_earnings` row (identical
  treatment — the tutor held the slot and was present, and §7.4 refunds the
  student nothing); `no_show_tutor` writes none. Split by `splitEarnings`, called
  not inlined; `status = 'held'`; `available_at = ended_at + earnings_hold_hours`.
- **The wallet is NOT touched.** A `held` row is a promise; the ledger entry is
  the money and is written when `release-earnings` flips `held` → `available`
  (Phase 8). Crediting `credit_balance` at completion would put unwithdrawable
  credits into it and `reconcile-wallets` would fire on its first run, correctly.
- **Idempotent twice over:** every predicate stops matching the rows it just
  moved, **and** `tutor_earnings.booking_id`'s UNIQUE is used with `ON CONFLICT DO
  NOTHING`, so the window between a transition committing and its insert running
  cannot double-pay. The falsification pass shows these are genuinely two
  guarantees: removing the second left the first's test green.
- **`getEarningsSettings()`** added to `lib/settings.ts` on the
  `getBookingSettings` pattern — `platform_fee_percent` and `earnings_hold_hours`
  had no accessor because nothing in `src/` read them until now.
- **`tests/unit/fees.test.ts`** — the authoritative money split had no unit test
  at all despite being the one place the platform/tutor division is decided.
- **`tests/integration/complete-sessions.test.ts`** — 12 tests in the DB-backed
  lane: both predicates in isolation, all three classifications, the `ended_at`
  cap holding on a late run, earnings written for `completed` and
  `no_show_student` and not for `no_show_tutor`, the split and `available_at`,
  idempotence on immediate re-run, and the double-pay window.
- **The `@/db` mock in `session-end-concurrency.test.ts` now forwards `select`**,
  extended before this pass's coverage was written — the omission had already
  caused one misdiagnosis in Part 3B's falsification pass.

**Verified (before the pre-merge review fix):** `pnpm lint` clean, `pnpm
typecheck` clean, `pnpm test` 293 passed / 26 files, `pnpm test:db:test` 29
passed / 3 files. **Falsification: five breaks, four failed exactly the
predicted tests; the fifth (inline round-half-up instead of `splitEarnings`)
failed NOTHING** — the fixtures' gross amounts (41, 60) did not straddle a half,
so floor and half-up agreed. Fixtures changed to 50 (12.5) and 30 (7.5) with the
expected numbers pinned literally; the identical break then failed 3 tests. Both
runs are in `DECISIONS.md`. **After the fix that landed in the same squashed
PR** (the NULL-`price_credits` skip, above): `pnpm test:db:test` 30 passed / 3
files — the 29 above plus one new test for the skip path; the unit lane count is
unchanged, since that fix is DB-lane-only.

**Absent rather than stubbed, in PR #39 itself:** the `pg_cron` snippet and its RUNBOOK step, the
`/admin/settings` "run now" button, `release-earnings`, withdrawals, anything in
`lib/credits/ledger.ts`, screen share, chat and emails. **The snippet and RUNBOOK step are what PR
#40 built and this session's scheduling closed — see the "Current state" section above for the
live-verified result.** `CRON_SECRET` rotation was never the blocker it was described as during PR
#39 (it had already closed on 2026-08-23, before this phase started; the "still open" wording in
that PR was itself an error). Nothing about correctness waited on the schedule while it was
missing: the four Part 3B actors still end any elapsed session with a person in the room, and a
late run writes the same `ended_at` an on-time one would — but see "Current state" above for what
specifically depended on the schedule (`tutor_earnings` and the both-parties-offline transition),
and now doesn't.

## What Phase 6 Part 3B built

**The server-side end of a session, and the hard stop that holds when nobody is
watching — plus, in the remainder pass (PR #35), the §9 control-bar mic/camera
toggles and the 80%-margin token renewal.** ~~Not the control bar: the §9
mic/camera toggles, screen share, chat, credits consumed/earned and the token
renewal are a separate pass and are absent rather than stubbed.~~ — **DONE for
mic/camera toggles and token renewal (PR #35).** Screen share, chat and credits
consumed/earned remain absent rather than stubbed; no merged pass has touched
them.

**No migration, no RLS change, nothing in `lib/credits/`, no `tutor_earnings`, no
`is_live` write, nothing under `drizzle/`.**

- **One conditional `UPDATE`** — `endInstantSessionByParticipant` and
  `endElapsedInstantSession` in `db/queries/sessions.ts`, sharing one SET clause.
  `status = 'in_progress'` in the WHERE is the entire exactly-once guarantee: a
  second writer blocks on the row lock, re-evaluates under READ COMMITTED, and
  matches zero rows. No CTE, no read-then-write, no wrapping transaction.
  Written through the query builder so `.returning()` decodes real `Date`s and
  no second `toDate`-style boundary is introduced.
- **`ended_at` is capped at the deadline** — a late close records
  `started_at + duration`, not when it was noticed, so Part 3C's cron writes the
  same record the deadline actor would have. Its own `DECISIONS.md` entry.
- **`billed_minutes = duration_minutes`** — resolved a SPEC-vs-SPEC conflict
  (§4.3's "actual" against §7.4's flat billing) in favour of §7.4; §4.3 amended
  in the same commit so it is not re-opened from the old wording.
- **`started_at IS NOT NULL`** — a session whose pair never completed cannot
  reach `completed`, so Part 3C keeps its `no_show_*` classification.
- **Four enforcement actors**, in the order they fire: `getSessionState` (the
  actor *at* the deadline), `POST /api/agora/token` (re-entry guard; becomes the
  continuous guard when renewal lands), `endSession` (early exit), and the room's
  server read, which **refuses without writing**. Both parties offline is left to
  Part 3C by decision, not omission.
- **The deadline is a pair** — `lib/sessions/deadline.ts` (pure) and
  `sessionElapsedSql` (authoritative). §12 amended to make Part 3C's cron call the
  shared fragment rather than invent an instant predicate; §12 previously
  described only the scheduled half, and `scheduled_end_at` is NULL for every
  instant booking.
- **No polling.** The countdown is cosmetic and makes no network call; the client
  asks the server at three *events* (mount, other party arrives, countdown hits
  zero). The other party is told by the Agora SDK's `user-left` — `bookings` is
  not in the Realtime publication and adding it would have been a migration.

**PR #35's remainder** — `SessionClient` gains `toggleMic`/`toggleCamera`
(`setEnabled`, not unpublish/republish) and `renewToken` (swaps credentials
without leaving the channel); `toggleCamera` returns `null` for a student
(confirmed in code that no camera track is ever created for that role, not
`false`). A new `useTokenRenewal` hook re-arms one `setTimeout` off the token
route's `expiresAt` on each successful renewal; a refusal re-runs
`refreshState` — the same path the countdown's expiry already uses — rather
than special-casing elapsed client-side. New files: `src/hooks/use-token-renewal.ts`,
`src/lib/agora/client.ts` (toggle/renewal additions), `src/lib/agora/renewal.ts`,
`tests/unit/agora-client-toggle.test.ts`, `tests/unit/agora-renewal.test.ts`.

### Phase 6 Part 3B — shipped state

- **`pnpm lint`, `pnpm typecheck` and `pnpm test` green** — 269 unit tests across
  22 files (25 new: `session-deadline`, plus elapsed cases on
  `agora-session-access`).
- **`pnpm test:db:test` green — 17 tests, 2 files**: the 4 pre-existing
  `stampSessionJoin` properties plus 13 new in
  `tests/integration/session-end-concurrency.test.ts` (concurrent ends, end
  racing the deadline, idempotence, the `ended_at` cap both ways, early-exit
  `now()`, never-started, non-participant, not-yet-elapsed, and four
  SQL/TypeScript boundary-agreement cases). Still deliberately **not in CI**.
- **The suite was proved capable of failing** against five deliberate breaks.
  Three matched the prediction exactly; **two did not, and are recorded as run** —
  break 1 first failed for the wrong reason (a gap in the test's `@/db` mock, not
  the guard) and was re-expressed, and **break 3 failed nothing at all**: the
  no-CTE property is unobservable while the status guard stands, so it is defence
  in depth upheld by review, not by the suite. Full table in `DECISIONS.md`.
- **Nothing was run against the shared project.** No migration, seed, reset or
  `db:verify-rls`. The DB-backed lane targets the disposable test project only,
  guarded by the hardcoded `TEST_PROJECT_REF`.
- **Still unverified: the Agora media path** — two live participants publishing in
  one channel needs two authenticated browsers and real devices. Unchanged from
  Part 3A, a §15 E2E concern, and not a blocker for Part 3C.
- **§15 E2E path 2** ("session ends → earnings appear") becomes assertable at
  Part 3C; nothing in the E2E suite was touched here.
- **Carry forward for Part 3C's integration work, not resolved here:** the
  `@/db` mock used by `tests/integration/session-end-concurrency.test.ts`
  forwards **`execute` and `update` only** — no `select`. A `db.select()`-based
  pre-read in a falsification break failed with `TypeError: db.select is not a
  function` and was first misdiagnosed as the guard failing; it was the mock,
  not the guard (see `DECISIONS.md`, "Break 1 first failed for the wrong
  reason"). Part 3C's cron will read via `select` somewhere in its own
  integration coverage — extend the mock's forwarder before trusting a
  `db.select` failure there as a real finding.

## What Phase 6 Part 3A built

**The room the Part 2 handshake lands in, and the join path into it — not the controls.** The
elapsed timer, credits consumed/earned, mute and camera toggles, screen share, chat, end-session and
the hard stop are Part 3B; `tutor_earnings` and the completion cron are Part 3C. They are **absent
rather than stubbed** — an inert control that looks live is worse than one that is not there.

**No migration, no RLS change, nothing in `lib/credits/`, no LessonSpace.**

- **`POST /api/agora/token`** — takes `{ bookingId }` and returns
  `{ token, uid, appId, channel, expiresAt, isTutor }`. `requireApiUser()` first; participation,
  booking state and role are one pure decision in `lib/agora/session-access.ts`. A booking that does
  not exist and one the caller is not part of return the **same 404**. Config failure → 503, token
  service failure or timeout → 502; neither throws.
- **Both participants get a `publisher` token** (SPEC §9 step 2). The media split — tutor publishes
  camera + microphone, student publishes microphone only — is enforced in `lib/agora/client.ts`. A
  subscriber token for the student would forbid the audio the design requires, and works in Bubble
  only because Agora's co-host authentication is off for the project.
- **Role and identity are derived server-side.** No request field feeds them. This is the real
  improvement over Bubble, which compares profile ids in browser JavaScript.
- **`lib/agora/client.ts`** — `SessionClient`, dynamic-importing the SDK (it does not tolerate SSR).
  Constructed synchronously so a React effect can dispose it **mid-join**; every `await` inside
  `join()` re-checks a disposed flag and tears down what it already created. `stop()` then
  `close()` on every local track — `close()` is what turns the camera light off. Exposes `join` and
  `leave` only; the §9 toggles are Part 3B.
- **`/session/[bookingId]`** in a new **`(session)` route group** — the one authenticated area both
  roles enter, so it cannot sit under `(student)` or `(tutor)` without a `requireRole` redirecting
  half the room away. The layout guards signed-in + onboarded + not suspended; the page checks
  participation; the token route checks it again.
- **First-join writes** — one idempotent `UPDATE` in `db/queries/sessions.ts`, run from the token
  route (mirroring §7.7 step 4). Backfills `agora_channel` if null, stamps the arriving party's
  `*_joined_at`, and sets `started_at` **only on the write that makes both non-null** (§4.3). It
  references the target row rather than a CTE, so a concurrent join re-evaluates against the locked
  row instead of writing back a stale null. Status untouched — instant bookings are already
  `in_progress` from the accept transaction.
- **Warm ping** — `cron/sweep-presence` now GETs the token service's `/ping` and reports it in the
  job summary. Never throws, cannot fail the sweep.
- **SPEC §9 corrected.** Its "confirmed against the live app" note claimed Bubble's client-side role
  choice was "the same publisher/subscriber split this section already specifies". Step 2 specifies
  no split, and a client-chosen role is what §9 exists to prevent. That sentence is what created the
  contradiction the build brief inherited.

### Phase 6 Part 3A — shipped state

- **Merged 2026-08-24 as PR #29 (`4141d4a`).**
- **Nothing was run against the shared project.** No migration, seed, reset or verify script touched
  `mipnoxlhurdbaahmvhhx` or the test project. `db:verify-rls` was **deliberately not run**: this
  phase changes no policy, and the script makes a material edit to seeded rows in the project that
  also serves production.
- **`pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` are green** — 244 tests across 21
  files, 22 of them new (`agora-session-access`, `agora-token-contract`). The build confirms the SDK
  stays out of the shared bundle: `/session/[bookingId]` is 7.75 kB against a 185 kB baseline.
- **One dependency added**: `agora-rtc-sdk-ng@4.24.7`, which SPEC §2 already pins.
- **~~KNOWN GAP, blocking Part 3B~~ — the SQL half is CLOSED (2026-08-24, `test:db:test`).** The
  `started_at` concurrency properties are no longer code-inspection-only: all four are asserted in
  `tests/integration/session-join-concurrency.test.ts` against the shipped statement, on two real
  connections whose contention is confirmed via `pg_blocking_pids` before anything is asserted. The
  suite was falsified against the CTE draft first — see the top of this file and DECISIONS.
  **What is still open is the Agora media path**, which is a different claim: two live participants
  publishing in one channel needs two authenticated browsers and real devices, and has never been
  exercised. That belongs to the §15 E2E paths, and it does **not** block Part 3B — Part 3B's timer
  reads the column, which is now covered.
- **The token service cold start is real and measured**: a probe during this build took **22s** on
  the first request. The route allows 45s with `maxDuration = 60`; the warm ping is what keeps that
  path cold-start-free in practice.

## Bubble live-app investigation (2026-08-24)

**Four read-only passes over the live Bubble app (`nowtutors.com`) — `student_dashboard` structure,
its workflows, Agora-vs-Lessonspace, and a full auth audit.** No application code touched.
**Merged via PR #28 (`0955801`).** Full findings and decisions already live in `DECISIONS.md` under
"Bubble live-app investigation — findings and six decisions (2026-08-24)", and SPEC §3.1, §7.4, §7.7,
§7.11, §9, and §18 item 8 were amended in that same commit — this section indexes them rather than
restating them.

- **Finding A — Agora confirmed for two-way session rooms, not just broadcast preview.** An earlier
  session in this project believed Agora was broadcast-only; the live app runs it in `rtc` mode for
  the actual session room. **The Phase 6/7 Agora-vs-Lessonspace split was CONFIRMED correct, not
  changed** — nothing to redo.
- **Finding B — no request/accept flow exists in Bubble.** Bookings are created immediately on
  payment; there is no request type, no accept step, no expiry. This rebuild's `session_requests`
  model (§7.4) has **no Bubble counterpart** — it's our own design, so "Bubble is ground truth"
  doesn't apply to it. Recorded so a future session doesn't go looking for a Bubble flow to reconcile
  against.
- **Six decisions taken from the investigation** (already in `DECISIONS.md` and `SPEC.md` — see
  there for full text, not restated here): (1) the credit-burn model is rejected, not ported;
  (2) the client-side burn is recorded as a live Bubble revenue leak this rebuild's server-side hard
  stop removes by construction; (3) held-earnings-on-completion (§7.11) is confirmed as a **deliberate
  correction** to Bubble's pay-before-session model, not a gap to close; (4) `total_withdrawn` is
  never written in Bubble — a live financial defect that must **not** be reproduced (this rebuild
  derives "available to withdraw" from the ledger instead); (5) the `is_live`/`online_status` split
  SPEC §3.1 forbids is confirmed present in Bubble, validating the rule rather than changing it;
  (6) the 25% platform fee is confirmed as the live commercial term.

## Student `/dashboard` fix (2026-08-24, PR #30)

**Standalone defect fix, not part of Phase 6.** `src/app/(student)/dashboard/` had only
`bookings/`, `favourites/`, `wallet/` and a `.gitkeep` — no `page.tsx`. `guards.ts`'s
`homeFor.student`, `actions/onboarding.ts`'s post-onboarding redirect, and the sidebar nav
(`nav-config.ts`) all already pointed at `/dashboard` correctly; the missing page was the entire
bug, same defect class as the earlier tutor `/tutor` 404 fix (Phase 6 Part 1). **Merged via
PR #30 (`7afea77`).**

- **SPEC citation error caught mid-build.** The build prompt cited SPEC §11 for the dashboard spec;
  §11 is actually "Email," unrelated. Flagged to the advisory seat before writing any code rather
  than silently substituting or guessing. The real (thin) spec is one line in §6 Routes: `/dashboard
  — Stat cards, next session, recent tutors, wallet balance`. Content beyond that line — stat-card
  choices, empty states, the "recent tutors" shape — was built from existing query/component
  patterns (`getBookingsForParticipant`, `getWalletBalanceFor`, the `getFavouriteTutors` join shape,
  `StatCard`/`EmptyState`/`Avatar` primitives) per explicit follow-up guidance from the advisory
  seat, confirmed before proceeding — not invented independently.
- New query: `getRecentTutorsForStudent` in `src/db/queries/bookings.ts`, scoped to the caller's own
  `studentId` in its `WHERE`, mirroring `getFavouriteTutors`'s approved/non-suspended visibility
  rule.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (244 passed) and `pnpm build` all green; the guard chain
  was traced by code reading (`requireRole("student")`), not exercised in a dev server.

## What Phase 6 Part 2 built

**The instant-session handshake and its billing — not the room it lands in.**
`/session/[bookingId]`, the Agora client, `/api/agora/token`, end-session, `complete-sessions` and
`tutor_earnings` are Part 3. Where Part 2 navigates into that route it carries a
`TODO(Phase 6 Part 3)`; until Part 3 ships, an accepted request lands on a 404 with the booking
already created, paid for and `in_progress`.

**No migration.** `0014` (Part 1) already shipped every column, enum value, index, RLS policy and
Realtime publication entry this phase writes to.

- **Server actions** — `src/actions/session-requests.ts`: `createSessionRequest`,
  `declineSessionRequest`, `acceptSessionRequest`, plus `getIncomingRequest` (the guarded read the
  tutor's modal enriches from). Each re-checks role and identity server-side and returns a **typed
  result**; nothing throws a string. `createSessionRequest` validates tutor liveness against the
  **`live_tutors` view** (never `is_live`), `accepts_instant`, the duration against
  `session_durations`, the subject against `tutor_subjects`, one-pending-request, and balance ≥
  price — then computes `price_credits` with `sessionPriceCredits()` and **pins** it with
  `duration_minutes` on the row. `expires_at` is `now() + instant_request_ttl_seconds` computed by
  **Postgres**, not by the app server.
- **The accept transaction** — `src/lib/session-requests/accept.ts` (pure, store-agnostic, the same
  shape as `lib/paypal/settlement.ts`) with `src/db/queries/session-requests.ts` as the Drizzle
  adapter. One transaction: lock the request `FOR UPDATE` → refuse-and-expire if past `expires_at` →
  refuse if not `pending` → refuse on a colliding scheduled booking → debit the **pinned** price as a
  single `booking_debit` → insert the `instant` / `in_progress` booking with
  `agora_channel = session_{booking_id}` → mark accepted → auto-decline the tutor's other pending
  requests. The booking id is generated in application code so the channel is known before the INSERT.
- **`failed_payment` survives the rollback.** An insufficient balance rolls the whole accept back,
  then a **separate statement** — conditional on the row still being `pending` — writes
  `failed_payment`. Not `expired`, not `declined` (§4.3).
- **The collision read is a real overlap.** SPEC §7.4 stated only `scheduled_start_at < now() +
  duration_minutes`; `scheduled_end_at > now()` was added, because nothing sets `completed` until
  Part 3 and the literal reading would have blocked every tutor with any past booking, forever. SPEC
  §7.4 amended; see DECISIONS.
- **Realtime, both directions** — `src/hooks/use-session-requests.ts`. Tutor: INSERT/UPDATE where
  `tutor_id = me`, driving an incoming-request modal mounted in the `(tutor)` layout so a request
  finds the tutor on any tutor page. Student: UPDATE on their own row, with a **distinct** message
  for accepted / declined / expired / cancelled / `failed_payment`. Payloads are treated as
  notifications — display data is read back through a guarded action.
- **Student request UI** — `InstantRequestWidget` on `/tutors/[slug]`, replacing Part 1's disabled
  "Request now" button with its own "Start now" card: duration picker **with the price against each
  option**, optional subject, optional note, affordability warning, then a waiting modal with the
  60-second ring. Both rings are **cosmetic** (`src/hooks/use-countdown.ts`) — they tick a deadline
  already in hand and make no network call, so neither is the polling CLAUDE.md forbids.
- **Cron** — `GET`/`POST /api/cron/expire-requests`, bearer-guarded (**503 when `CRON_SECRET` is
  unset**), idempotent, structured counts. The guard itself moved to
  `lib/auth/api-guards.ts#cronAuthFailure` and `sweep-presence` now calls it too. `sweep-presence`'s
  `TODO(Phase 6 Part 2)` is filled in: a swept tutor's pending requests expire immediately and the
  count is returned as `pendingRequestsExpired` (no longer `null`). Snippet:
  `drizzle/snippets/pg_cron_expire_requests.sql`.
- **Tests** — `tests/unit/session-request-accept.test.ts` (16 cases: the four refusal paths, all four
  collision boundaries, the auto-decline, and the price-pinning property in both directions), and the
  request-expiry half of `tests/e2e/presence-ungraceful-exit.spec.ts` is **un-`fixme`d** — it asserts
  the wallet balance is unchanged after an unanswered request and that the dead request stops holding
  the student's one-pending slot, **with neither cron running**.
- **Docs in the same commit** — SPEC §4.3, §7.4, §7.5, §8, §12, §15; DECISIONS gained a Part 2
  section; RUNBOOK gained the expire-requests scheduling step; PROGRESS is this section.

### Phase 6 Part 2 — shipped state

- **Nothing was run against the shared project.** No migration was needed and none was applied; no
  seed, reset or verify script was run against `mipnoxlhurdbaahmvhhx` or against the test project.
- **`pnpm lint`, `pnpm typecheck` and `pnpm test` are green** — 222 tests across 19 files, 16 of
  them new. An earlier run of the same suite failed two **pre-existing** specs
  (`pending-payment-slots`, `slot-validation`) on Vitest's 5-second default timeout under parallel
  load; both pass on their own and reproduce the same way on `main`. Nothing about that is specific
  to this phase, but it does mean a green suite is machine-load-dependent — see "Still open".
- **The E2E has still never had a green run** — the same carry-forward Part 1 left, now with a
  second test in the file. Not run here (the phase prompt excluded it), and it needs the test project
  seeded and Playwright pointed at it.
- **⚠️ `CRON_SECRET` rotation is still open and now actually matters.** RUNBOOK flagged it as
  blocking Part 2 precisely because `expire-requests` sits behind the same secret. The route and the
  pg_cron snippet are written; **do not schedule the job until the secret is rotated.**

## What Phase 6 Part 1 built

**Presence and the schema cleanup only.** Session requests, Realtime, billing and the session room
were Parts 2 and 3, and were absent rather than stubbed — where Part 1 code would otherwise reach
into them it carried a `TODO(Phase 6 Part 2 / Part 3)`. The Part 2 half of those is now filled in
(above); only the `TODO(Phase 6 Part 3)` markers remain.

- **Migration `0014`** (`drizzle/0014_phase6_presence_cleanup.sql`, partly hand-written):
  `session_requests` gains `duration_minutes` + `price_credits` (both `integer NOT NULL`, **no
  default** — server-authored at insert); `session_request_status` gains `failed_payment`;
  `tutor_profiles.instant_rate_credits_per_minute` dropped; the `instant_hold` / `instant_release` /
  `instant_capture` `credit_transaction_type` values removed via the rename-create-alter-drop dance.
  `live_tutors` is dropped and recreated around the column drop (it enumerated that column) —
  identical otherwise, threshold and grants included. Two `DO`-block guards abort the migration with
  a readable message if either table turns out to hold rows the plan assumed absent. **Pre-flight
  counts against the live project were 0 and 0.**
- **Heartbeat** — `POST /api/presence/heartbeat` (`requireApiUser()` first, identity from the
  session, never the body) and `usePresence()` mounted once in `AppShell`, so every authenticated
  area heartbeats and no public page does. Fires on mount, every 30s while visible, pauses on
  `document.hidden`, fires immediately on visible. It never writes `is_live` in either direction —
  **there is no `pagehide` / `sendBeacon` handler**; one was built and removed before merge because
  `pagehide` cannot tell a reload from an exit (see DECISIONS, "Same-PR revision"). Staleness is now
  **two** defences, not three: the `live_tutors` view and the sweep.
- **Go live** — `/tutor` now exists (it 404'd before) and hosts the "Available for instant sessions"
  toggle. The action re-checks role, approval, suspension and verified email server-side, and is
  **unrestricted by the tutor's calendar** — the scheduled collision is an accept-time check, built
  in Part 2.
- **Sweep** — `GET`/`POST /api/cron/sweep-presence`, bearer-guarded (**503 when `CRON_SECRET` is
  unset**, never open), idempotent, returns structured counts. Work set derived from the
  `live_tutors` view, not from any threshold of its own. Scheduled by **Supabase pg_cron + pg_net**
  (`drizzle/snippets/pg_cron_sweep_presence.sql`, RUNBOOK) because Vercel Hobby crons are daily.
  **No `vercel.json`.**
- **Tests** — `tests/unit/presence-staleness.test.ts` (7 cases: the boundary at exactly 2 minutes
  and either side, plus an anti-drift check that parses the interval literal out of `0014`) and
  `tests/e2e/presence-ungraceful-exit.spec.ts` (§15 path 3, presence half; the request-expiry half
  was `test.fixme` here and was written in Part 2). Playwright added as a devDependency — it was
  already in SPEC §2.
- **Docs in the same commit** — SPEC §3.5, §4.1, §4.3, §4.4, §7.4, §7.5, §12, §15; DECISIONS gained
  a Part 1 section; RUNBOOK gained `CRON_SECRET` and the pg_cron setup step.

### Phase 6 Part 1 — shipped state

**Migration `0014` is APPLIED** to the shared Supabase project (`mipnoxlhurdbaahmvhhx`) — 15
migrations recorded in the `drizzle.__drizzle_migrations` journal. Both `DO`-block guards passed
silently (both tables were still empty, as the pre-flight counts predicted). Post-conditions checked
directly against the live database: `session_requests.duration_minutes`/`price_credits` exist,
`NOT NULL`, no default; `session_request_status` has `failed_payment`; `credit_transaction_type` is
down to the 8 non-instant values with no leftover `_old` type; `tutor_profiles.instant_rate_credits_per_minute`
is gone; `live_tutors` is recreated without that column and keeps its 2-minute threshold,
`approval_status` filter, and `anon`/`authenticated` grants; `credit_tx_ref_unique` survived the enum
swap; the Phase 1 `tutor_presence_guard` trigger is untouched. **Production smoke-tested green**
after the migration: `/`, `/?live=1`, `/tutors/tom-turner`, `/login` all `200`.

- **Only the deliberate toggle-off clears `is_live` immediately.** Leaving `/tutor` — by link, tab
  close, or losing the connection — stops the heartbeat and lets the `live_tutors` view age the
  tutor out within the staleness window. This is the shape after the same-PR beacon removal (see
  DECISIONS' "Same-PR revision" and SPEC §7.5, both already correct on `main`); there is no reload
  false-positive because there is no `pagehide` handler at all.

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

## Still open — carry forward

- **A tutor in a session is advertised as available and cannot receive.** `IncomingRequests` is
  mounted in `app/(tutor)/layout.tsx` **only**. The presence heartbeat is mounted a level up, in
  `AppShell`, which the `(student)`, `(session)`, `(tutor)` and `admin` layouts all render. So on
  `/session/*` and `/classroom/*` — both in the `(session)` group — a tutor **keeps heartbeating**,
  stays inside `live_tutors`' `last_seen_at > now() - interval '2 minutes'` window, and is offered
  to students on `/tutors?live=1`, while the component that would show them the request is
  unmounted. Every request sent to them expires unanswered, exactly as if they had walked away.
  **`/tutors` itself is a different, milder case and the brief's framing of it was wrong:** it
  lives in `(public)`, which renders `PublicHeader`/`PublicFooter` and **not** `AppShell`, so a
  tutor browsing there stops heartbeating too and drops out of `live_tutors` after
  `PRESENCE_STALE_SECONDS` (120). The exposure there is bounded by the staleness window; in a
  session it is unbounded.
  **What has to be decided before fixing it, and why this was not done here:** either the modal
  moves up to `AppShell` (guarded to tutors) so it follows the heartbeat, or `is_live` is cleared
  on entering a session, or the two are deliberately allowed to differ. That is a product call
  about whether a tutor already teaching should appear live at all — §7.4 does not say — and it
  interacts with the accept path, which would be starting a second session on top of the one they
  are in. Not a rename; do not patch it as one.
- **⚠️ The instant request often never reaches the tutor — OPEN DEFECT, not resolved by
  PR #47/#48/#49.** A subscription that reports `SUBSCRIBED` does not reliably deliver
  INSERT events. See "Current state" at the top of this file for the full elimination
  list and the next diagnostic step (subscribe unfiltered and log every INSERT). Not
  data loss, not a money bug — a reload always surfaces the pending request — but it is
  a real UX defect and does not block Phase 8.
- **LessonSpace "end session for all" (leader control) did not respond to a click during
  the 2026-08-25 live verification.** Not investigated. May be a LessonSpace UI/dashboard
  quirk (e.g. the waiting-room/leader setting, RUNBOOK's unticked checklist item) or a
  real gap in the leader flag reaching the tutor's client. Everything else about that
  test passed — see "Current state" and SPEC §7.7.
- **PayPal sandbox credit purchase is now LIVE-VERIFIED (2026-08-25) — first captured
  evidence for Phase 5's acceptance criterion.** 100 credits landed in the wallet from a
  real sandbox checkout against the deployed app. **Still unproven:** the webhook-replay
  half of the acceptance criterion (a duplicate `PAYMENT.CAPTURE.COMPLETED` delivery must
  not double-credit the wallet) has not been exercised against the deployed app.
- **The public header does not reflect sign-in.** A signed-in user still sees Login/Sign
  up and a stale credit balance on the homepage. Likely a statically-cached server
  component with no session read. Cosmetic but badly misleading — worth fixing before
  it's seen by a real user rather than parking it with the Phase 10 polish items.
- **Two confirmed scheduled bookings exist for the same tutor at overlapping times**
  (10:58–11:58 and 11:00–11:30) **despite the `bookings_no_overlap` exclusion
  constraint**, which correctly refused a later test `UPDATE` attempting the same
  overlap. Either the constraint postdates those two rows or some write path bypasses
  it. Needs investigation **before cutover** — Bubble bookings get migrated in at that
  point and the same question applies to every row it brings.
- **The tutor sidebar links to five routes that don't exist:** `/tutor/withdrawals`,
  `/tutor/earnings`, `/tutor/broadcasts`, `/tutor/messages`, `/tutor/settings`. All are
  Phase 8/9 work; today they 404 on prefetch/click. Cosmetic, not a blocker, but leave
  this note rather than rediscovering it per route as each phase lands.
- **NEW FEATURE GAP, not a bug: a student cannot cancel a pending instant request.** The
  waiting modal's only control is an X that closes the modal — the request itself keeps
  holding the student's one-pending-request slot for the full 60s TTL. No credits are at
  risk (they're taken at acceptance, not request), but there's no way for a student who
  changed their mind to withdraw the request early. To be designed and built, not
  "fixed."
- **The app is noticeably slow — not investigated, parked for Phase 10 polish.**
  Candidate causes, none yet checked: Supabase project region vs. the Vercel function
  region (the build runs in `iad1`); serverless cold starts; whether `DATABASE_URL`
  points at the pooler or the direct connection. See RUNBOOK's launch-blocker note — the
  dev/prod Supabase project's region was never chosen deliberately, and choosing the
  production project's region deliberately at cutover is a candidate fix as well as a
  one-way decision.
- ~~**An unapproved tutor's `NEXT_REDIRECT` becomes a silent unhandled rejection.**~~ **FIXED
  2026-08-25 (`fix/realtime-subscription-resilience`).** `getIncomingRequest` — and the new
  `listPendingIncomingRequests` — now pass `{ requireApproval: false }`, agreeing with the
  `(tutor)` layout that mounts their caller. Approval is not what authorizes those reads;
  ownership is, and both are scoped to `tutor_id = me`. The `.catch` stays and now logs rather
  than tracing. The rule is in SPEC §5. The accept/decline actions keep approval enforced. Original
  finding kept below for the reasoning:
  `getIncomingRequest` (`actions/session-requests.ts:264`) called `requireRole("tutor")` with the
  default `requireApproval: true`, and `requireRole` calls Next's `redirect()`, which **throws**.
  Its one caller is `onIncoming` in `incoming-requests.tsx:64`, which is a fire-and-forget
  `void (async () => { … })()` with no `catch`. So an unapproved tutor whose subscription does fire
  gets an unhandled promise rejection in the browser and nothing else — no redirect (there is no
  Server Component render to unwind), no toast, no log. The `(tutor)` layout deliberately relaxes
  the guard to `requireApproval: false` so `/tutor/pending-approval` does not redirect-loop, and
  its comment argues the subscription "simply never fires" for an unapproved tutor because
  `live_tutors` requires approval — true for the normal path, and not a reason for the action to
  throw into a floating promise when it doesn't hold.
  **What has to be decided:** whether `getIncomingRequest` should return `{ error }` for an
  unapproved tutor instead of redirecting (it already returns `{ error }` for every other refusal),
  or whether the caller should catch. The first changes a guard shared with the accept/decline
  actions and needs a look at all three together.
- ~~**There is still no mount-time query for pending requests — the tutor side relies on the
  Realtime event alone.**~~ **FIXED 2026-08-25 (`fix/realtime-subscription-resilience`).**
  `getPendingRequestsForTutor` → `listPendingIncomingRequests` → read on mount **and** after every
  successful (re)subscribe, deduplicated by request id (`mergeIntoQueue`). Not a `setInterval`:
  two reads per page load. Original finding kept below:
  `IncomingRequests` started with an empty queue and only ever filled it from an
  INSERT payload. Nothing reads `session_requests` on mount. So any request that arrived while the
  tutor was between pages, mid-navigation, disconnected, or on a route where the component is not
  mounted (see the first item) is gone for good — **and a refresh surfaces nothing**, which is why
  refreshing during the investigation showed an empty screen even though a `pending` row existed.
  With the countdown fixed, the live path works; this is the whole class of requests the live path
  never sees.
  **What has to be decided:** a guarded Server Action reading this tutor's `pending`,
  not-yet-expired requests, called on mount and merged into the queue by id (the existing
  `q.some(r => r.id === …)` dedupe already covers the overlap with an INSERT arriving at the same
  time). Straightforward, but it is a new read on the tutor's hot path and belongs with the mount
  decision above, not bolted on next to it. Do not implement it as a `setInterval` refresh —
  CLAUDE.md forbids that, and it is not what is missing.
- **Phase 7's classroom is unexercised end to end, and `LESSONSPACE_API_KEY` is unset.** No call
  has ever been made to LessonSpace from this codebase — every green test stops at the pure
  decision or at Postgres. Two participants in one room, the tutor holding teacher controls, the
  `confirmed → in_progress` transition firing on a real second arrival, and the iframe rendering a
  live `client_url` all need two authenticated browsers and a configured key. Same standing gap as
  the Agora media path, and a §15 E2E concern rather than a defect.
- **The Phase 7 Part 2 pages have not been looked at in a browser** at 360px or 1440px. Every
  classroom state is behind authentication, and reaching the *open* state needs a booking whose
  join window is now — which would mean writing to the dev Supabase project that also serves
  production. Worth doing with a seeded login before the branch merges.
- **§12 expire-unpaid cron not built — deferred to Phase 8.** Not load-bearing today: a
  `pending_payment` booking older than 20 minutes already stops blocking a slot on the **read**
  side (§4.2), and the booking transaction sweeps stale holds its slot collides with on the
  **write** side, so double-selling cannot happen without the cron. The cron is tidy-up (rows that
  sit `pending_payment` forever without a colliding booking to trigger the sweep), not correctness.
- **Refund-reverses-credits admin action NOT built — deferred, needs its own design pass.**
  `/admin/payments` (Phase 5 Part 2) is **read-only**: it shows what happened to a payment but
  cannot unwind one. `PAYMENT.CAPTURE.REFUNDED` already sets `payments.status = 'refunded'` and
  deliberately does **not** claw credits back — §18 item 4 makes reversing credits an **admin**
  action, not something a webhook does silently behind a student who may have spent them. Building
  it needs decisions this phase didn't take: partial refunds, a student whose balance is now below
  the amount to reverse (the `credit_balance >= 0` check would reject the debit), and whether a
  direct-pay refund also cancels the booking it paid for. Design it before coding it.
- **Bump the GitHub action versions to `@v5`** (`actions/checkout`, `actions/setup-node`,
  `pnpm/action-setup` are on `@v4` and warn as deprecated Node-20 runtimes).
- **~~Obsolete pricing remnants~~ — DONE in migration `0014`** (Phase 6 Part 1).
  `tutor_profiles.instant_rate_credits_per_minute` is dropped and the `instant_hold` /
  `instant_release` / `instant_capture` `credit_transaction_type` values are removed.
- **`tests/e2e/presence-ungraceful-exit.spec.ts` was debugged to passing locally during PR #25
  (`f7b8a0a`) — but that pass is not evidence, and the spec is not yet a gate.** PR #25's commit
  documents five real fixes found and fixed against this spec, each with concrete evidence (measured
  server latencies, piped server logs, trace excerpts) — that level of detail does not come from
  iterating against a spec nobody ran, so treating this as "never had a green run" is false.
  **The five, in the order hit — kept here as debugging context for whoever performs the re-run,
  not as evidence of a pass:**
  1. **Empty `ms-playwright` browser cache.** No browser had ever been installed; both tests failed
     at launch in 2ms. `pnpm exec playwright install` itself failed with `SELF_SIGNED_CERT_IN_CHAIN`
     downloading from `cdn.playwright.dev` — not interception (see RUNBOOK's CA entry) — fixed by
     routing the install through `scripts/with-ca-certs.mjs`.
  2. **`GoLiveToggle` rendered `is_live` as if it were liveness, so the test's own go-live click was
     a no-op.** The switch renders CHECKED from the stored `is_live` column; `live_tutors`
     membership also needs a fresh `last_seen_at` (§3.1). A tutor left over from a prior run —
     `is_live = true`, stale `last_seen_at` — rendered checked, so the setup's
     `if (!checked) click()` clicked nothing, `last_seen_at` was never refreshed, and the tutor was
     never actually live. This is the same conflation §3.1 exists to forbid — the spec's own test
     setup had committed the mistake the spec is there to catch. Fixed by forcing a real off→on
     transition regardless of starting state.
  3. **The 120s `webServer` boot budget expired mid-compile on a healthy server.** Under `next dev`,
     cold boot plus first-request compilation exceeded the timeout while nothing was actually broken.
  4. **`waitForURL` waited for a navigation event a Server Action redirect never emits.** The login
     action redirects via the Next router, updating history client-side with no event Playwright
     observes — a sign-in that had already landed on `/tutor` (confirmed via the trace: 303, RSC
     fetch, heartbeats firing) still timed out. Fixed by polling the URL (`toHaveURL`) instead of
     awaiting an event.
  5. **`goLive()` returned on optimistic UI before the server write landed.** `GoLiveToggle` flips
     `aria-checked` the instant it's clicked, before the Server Action resolves — observed directly
     in the server log, the tutor's profile was fetched one second before the go-live `POST` landed.
     Fixed by waiting for the confirmation toast, which only renders from the action's resolved
     result; `go-live-toggle.tsx` itself is untouched — see the open question below.

  But no runner output — no `2 passed`, no duration — is captured anywhere in #25's diff or commit message;
  the specific claim "confirmed green, 2 passed" lived only in prose in the now-closed PR #26, never
  in captured output, and no CI workflow has ever run `test:e2e`. **What actually happened: the spec
  was debugged to passing on one machine, once, locally, and that pass was never captured or
  independently verified.** It needs a re-run with the runner's own output kept (not just asserted in
  a commit message) before it can be treated as a CI gate or cited as settled. Two real bugs in the
  spec were found and fixed in PR #16 already: it matched the tutor by **display name** ("Tom
  Turner"), which never appears — the seeded `display_name` is `Tom` — so every assertion would have
  **silently passed as false** without ever exercising the intended path; and `signIn()` waited on
  the URL alone, so a rejected login burned the whole 5-minute timeout while reporting only "waiting
  for navigation" instead of the real cause. (`db:verify-rls` remains local-only for the same
  shared-project reason, though it too now has a `:test` variant.)
- **`GoLiveToggle` flips `aria-checked` optimistically, before the Server Action resolves — OPEN
  question, not a settled decision.** The E2E fix above (cause 5) waits for the confirmation toast
  instead of trusting the switch state, so the test suite no longer depends on this. Whether the
  component itself should stop flipping optimistically — and show a pending state instead — is a
  separate product decision that has not been taken.
- **~~CI `verify` does not run `pnpm build`~~ — DONE via PR #27 (`5396c3c`).** The required `verify`
  check now runs `pnpm build` alongside lint, typecheck and tests, so a change that compiles under
  `tsc` but breaks the Next build fails CI instead of reaching deploy undetected.
  **PR #6 (`fix/ci-build-step`), which had carried this same fix since 2026-08-21, was CLOSED
  UNMERGED — superseded by #27.** It was 19 commits behind `main` and CONFLICTING/DIRTY by the time
  #27 landed. Its CI change and its DECISIONS.md entry on the production-404/middleware diagnosis
  were already carried forward into `main` (present today); its stale `PROGRESS.md` edits were
  discarded rather than reconciled, since PROGRESS had moved on substantially across those 19
  commits.
- **~~Known gap, blocking Phase 6 Part 3B — `started_at` concurrency has no automated test~~ — DONE
  (2026-08-24).** `pnpm test:db:test` →
  `tests/integration/session-join-concurrency.test.ts`, four assertions against the shipped
  `stampSessionJoin` on two contending connections, proved capable of failing against the CTE draft.
  **Not in CI and must not be added** — no Postgres and no `.env.test` on the runner; it would fail
  the required `verify` check for infrastructure reasons. Run it by hand before changing `started_at`
  or anything computed from it. Two carry-forwards, neither blocking Part 3B: the **Agora media
  path** (two live browsers in one channel) is still unexercised and belongs to the §15 E2E paths,
  and ~~`JoinStamp`'s timestamps are **strings at runtime despite being typed `Date`**~~ — **DONE**,
  re-probed and fixed at the query boundary (see the top of this file and DECISIONS,
  "`stampSessionJoin`'s timestamps — probed, then fixed at the boundary"). The integration lane's
  normaliser was tightened to reject a string, so a reverted conversion now fails loudly instead of
  staying green.
- **Google OAuth — DONE, closed 2026-08-24.** Was flagged as a short standalone session in the prior
  entry; that session ran tonight. A Google Cloud OAuth client was created (consent screen External;
  scopes `email`, `profile`, `openid`; authorized redirect URI set to the **Supabase** callback
  `https://<project-ref>.supabase.co/auth/v1/callback`, not our own `/auth/callback`), and the
  client id + secret were entered into Supabase → Authentication → Providers → Google, which was then
  enabled. **Verified by a live click-through against the deployed Vercel app**: Google sign-in
  completes and lands signed in; the "provider is not enabled" 400 is gone. No credential values are
  recorded anywhere in these docs — they live in Google Cloud and Supabase only. See DECISIONS,
  "Google OAuth enabled" for the client-ID-vs-client-name gotcha that cost time during setup.
  **Still open, not closed by this session:** `pnpm db:verify-rls` has not been re-run since Google
  was enabled. That script is the observable proxy for the SPEC §7.1 no-duplicate-accounts
  guarantee (the dashboard's own same-email-linking toggle can't be read back — see RUNBOOK). Until
  it runs, same-email linking between a password account and the Google identity is asserted from the
  investigation's earlier finding, not freshly verified.
- **Signup "email confirmation not arriving" — MISDIAGNOSED, now corrected (2026-08-24).** What looked
  like a broken confirmation email was two dashboard misconfigurations, not an email-delivery or
  code defect. Established from Supabase auth logs and a direct `auth.users` query, not inferred:
  email delivery itself works (account `dadatosynseun@gmail.com` was created and confirmed
  2026-08-21, `confirmation_sent_at` 0.06s after `created_at`, `email_confirmed_at` 38s later). The
  apparent "no email" symptom on repeat signup attempts was Supabase's anti-enumeration behaviour —
  signing up again on an already-confirmed address logs `user_repeated_signup`, returns 200, and
  sends no email; our `/signup` page correctly shows the same generic "check your email" state
  either way. **This is correct per SPEC §7.1 and must not be "fixed" by revealing the account
  exists** — see DECISIONS for why a future reader might otherwise mistake it for a UX bug.
  Two real faults, both dashboard configuration, both now corrected:
  - **Site URL** was still `http://localhost:3000` after the app was deployed, so a confirmation
    email opened from any machine pointed at the user's own localhost. Now
    `https://nowtutors-brown.vercel.app`.
  - The `/auth/callback` **redirect URLs were not allow-listed**, so Supabase discarded the
    `emailRedirectTo` our code sends and fell back to the Site URL root — the link landed on
    `/?code=...`, which has no code-exchange handler, leaving the user signed out. Allow-list now
    contains `http://localhost:3000/auth/callback`, `https://nowtutors-brown.vercel.app/auth/callback`,
    and `https://*.vercel.app/auth/callback`.
  A later "Invalid email or password" on sign-in was a **consequence** of the redirect-URL fault, not
  a separate defect: the code was never exchanged, the account stayed unconfirmed, and Supabase
  returns the same generic error for an unconfirmed account as for a wrong password. No login-path
  defect.
  **NOT YET VERIFIED — recorded as open, not fixed.** A clean end-to-end click-through on the
  corrected settings (signup on Vercel → email → link lands on `/auth/callback` → `/onboarding`,
  signed in) has not been performed, blocked by `HTTP 429 over_email_send_rate_limit` from the
  built-in sender after tonight's testing. The corrected `redirect_to` **was** observed in the 429
  log lines, confirming the app sends the right callback URL — but the full flow is unproven. Cold
  re-test once the rate limit resets.
- **Repository hygiene — 32 stale branches deleted from origin, 26 deleted locally (2026-08-24).**
  Origin and local now hold only `main`. **`delete_branch_on_merge` is currently `false`** in the
  GitHub repo settings (confirmed via `gh api repos/:owner/:repo --jq '.delete_branch_on_merge'`) —
  turning on "Automatically delete head branches" is a **to-do**, not yet done, so this cleanup
  will recur on the next few merged PRs until it's enabled.
- **Two short outstanding items before Phase 6 Part 3C, neither phase work:**
  1. The cold signup end-to-end re-test (signup on Vercel → email → `/auth/callback` →
     `/onboarding`, signed in) once the Supabase built-in sender's rate limit resets — see the
     "Signup 'email confirmation not arriving'" entry above.
  2. A `pnpm db:verify-rls` run to assert the SPEC §7.1 no-duplicate-accounts guarantee now that
     Google OAuth is enabled — see the "Google OAuth" entry above, "still open, not closed by this
     session."
- **Two auth gaps found in the full audit — NOT YET FIXED, parked for a future short session.**
  - `requireOnboarded()` (`src/lib/auth/guards.ts`) is exported but has **no call site anywhere in
    the repo** — dead code — and it skips the `is_suspended` check that `requireRole()` has.
  - `redirectIfSignedIn()` also skips the `is_suspended` check.
  - No automated test coverage exists for the OAuth callback route (`src/app/auth/callback/route.ts`)
    or the `on_auth_user_created` trigger.
- **`tests/unit/pending-payment-slots.test.ts` and `tests/unit/slot-validation.test.ts` are slow and
  can time out on Vitest's 5-second default when the whole suite runs in one process under load.**
  Both pass on their own; both failed this way during the Phase 6 Part 2 run and reproduce the same
  way on `main`. Unrelated to any phase. Worth a `testTimeout` bump on the two files (or globally)
  — as it stands, a green suite is machine-load-dependent, which is exactly the kind of flake that
  teaches people to re-run rather than read.
- **Approval and rejection emails are `TODO(Phase 10)` hooks — nothing is sent.** The hooks are
  marked in `src/actions/admin-tutors.ts`; Resend wires in Phase 10.
- **Tutor profile diff view not built.** The admin "Edited since review" tab flags the profile and
  timestamps it (changed at / last reviewed) but does not show *what* changed — that needs a history
  table or a stored snapshot, which is a design decision rather than a cheap add. Deferred.
- **User Role option-set values** — confirm against Bubble (we assume student/tutor/admin).
- **`credit_transaction_type` value check** — the enum now reads `purchase`, `booking_debit`,
  `booking_refund`, `session_earning`, `withdrawal_hold`, `withdrawal_paid`, `withdrawal_reversed`,
  `admin_adjustment` after `0014`. Still worth confirming those eight against the live build at cutover.
- **Bubble→rebuild pricing model change needs a Phase 10 data migration and cutover comms.** Bubble
  prices every session at duration ÷ 3 credits — one flat platform rate for all tutors. The rebuild
  prices off each tutor's `hourly_rate_credits`. At cutover, every existing tutor needs a rate set and
  every existing student sees prices change from the flat rate they're used to. See DECISIONS.md
  Phase 6.

## Notes / non-bugs (do NOT re-investigate)

- **Bubble drives session length from a client-side countdown** (status = `Completed` when
  `credits_remaining <= 0`, then `endSession()`), decrementing one credit per tick on a **180-second**
  interval — the withdrawn "1 credit = 3 minutes" rule working exactly as designed, not a units bug.
  (**Correction, Phase 6 pre-build, 2026-08-22:** an earlier pass had this at 180 *milliseconds*,
  which would read as a bug ending a 60-minute session in ~4 seconds; live-app inspection confirmed
  it's 180 seconds. See `DECISIONS.md` Phase 6.) Either way, the rebuild computes elapsed time
  **server-side from `started_at`** and does not port the client countdown.
- **Theo's blank avatar circle** is expected: the seed uploads a **1×1 transparent PNG** for
  `theo-chen` purely to prove the Storage → `next/image` pipeline. Not a rendering bug.
- All other tutors show **initials** (no uploaded avatar) — also expected.
- Seeded tutors read **"Offline"** until someone actually goes live. Presence exists as of Phase 6
  Part 1, but the seed does not set `is_live` — status derives from the `live_tutors` view, so a
  tutor shows live only after toggling on `/tutor`, and only while their heartbeat stays fresh.
- **`db:verify-rls` mutates seeded rows** (it makes a material edit to `tutor1` to prove the
  re-review flag survives). Re-run `pnpm db:seed` afterwards to restore a tidy dev dataset.

## Env / toolchain gotchas

- **`NODE_EXTRA_CA_CERTS` is now automatic for `db:*` scripts** (Node's bundled CA rejects the
  Supabase chain; curl/system CA is fine). `scripts/with-ca-certs.mjs` sets it when unset — no
  prefix needed on any `db:*` / `db:*:test` command. **Other commands are not wrapped**: a
  `pnpm build` / `pnpm dev` / bare `tsx` run that hits the Supabase chain still needs
  `NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem` exported manually. Symptom when it's missing:
  `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, which looks like a credentials or network failure and is
  neither.
- **Migrations + admin scripts run over the Supabase session pooler** (port 5432); the legacy
  `db.<ref>.supabase.co` direct host does not resolve. Runtime Drizzle uses `{ prepare: false }`.
- **zsh quotes special chars.** Quote args containing `#`, `(`, `)`, or globs — e.g. the
  `src/app/(public)/…` route-group paths and `grep --include='*.ts'`.
- **`pnpm db:reset` is destructive** (drops `public`) — **dev only**, and "dev" is the project that
  also serves production (below). `.env.local` holds those creds (ref `mipnoxlhurdbaahmvhhx`,
  eu-west-3). Use **`pnpm db:reset:test`** for anything disposable: it targets the test project only
  and is guarded by the hardcoded ref.
- **Production still runs on the DEV Supabase project** (`mipnoxlhurdbaahmvhhx`). There is no
  separate prod database — every deploy reads/writes the same project the local seed and
  `db:verify-rls` run against. Provisioning a real prod project is unstarted; until then, treat
  anything in that project as live data, not disposable fixtures. **The test project
  (`uietkphpfqaicbndunwt`) does not change this** — it is for seeding and E2E, not a prod stand-in,
  and nothing deploys against it.
- Seed login password for all seeded users: `Password123!` (`student1@nowtutors.dev`,
  `tutor1@nowtutors.dev`, `admin@nowtutors.dev`).
- **Run the local gates before pushing**: `pnpm typecheck && pnpm lint && pnpm test && pnpm build &&
  pnpm db:verify-rls`. CI (`verify`) is now a required check on `main`, so a red gate blocks the
  merge rather than merely warning — but `db:verify-rls` needs dev credentials and runs locally only.
