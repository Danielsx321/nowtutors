# NowTutors — Runbook

Deploy and third-party configuration checklist. Created in Phase 0 (SPEC §17),
completed through the build. Each item is ticked as it is verified in the target
environment.

## Environments

- **Dev Supabase:** project ref `mipnoxlhurdbaahmvhhx` (eu-west-3). Only environment
  in use during Phase 0. No prod project yet.
- **Deploy target:** Vercel **Hobby**. **There is deliberately no `vercel.json`** — Hobby
  crons run at most **once a day**, which cannot serve a 5-minute presence sweep. Scheduled
  jobs run on Supabase **`pg_cron` + `pg_net`** instead (settled in Phase 6 Part 1; see
  SPEC §3.5/§12 and the pg_cron section below).

## Database connections (important)

- `DATABASE_URL` — Supabase **transaction pooler** (`...pooler.supabase.com:6543`).
  Used by the app at runtime via Drizzle (`src/db/index.ts`), initialized with
  `{ prepare: false }` because transaction pooling does not support prepared statements.
- `DIRECT_URL` — intended for migrations. **On this project the legacy direct host
  `db.<ref>.supabase.co` does not resolve (IPv4/DNS).** Migrations therefore use the
  IPv4 **session pooler** (same pooler host, **port 5432**, `sslmode=require`).
  `drizzle.config.ts` prefers `DIRECT_URL` but auto-derives the session-pooler URL from
  `DATABASE_URL` when `DIRECT_URL` is unset or still points at the legacy direct host.
  **Action for prod / new machines:** set `DIRECT_URL` to the session pooler string
  (port 5432) from the Supabase dashboard → Connect.

### Test Supabase project

A disposable `nowtutors-test` Supabase project exists for local seeding and E2E runs, kept
separate from dev/prod so it can be wiped freely. Its credentials live in `.env.test`
(gitignored, never committed — see `.env.test.example` for the key list and comments on
`DATABASE_URL`/`DIRECT_URL`). **Project ref: `uietkphpfqaicbndunwt`.**

**Targeting mechanism:** every db script has a `:test` pnpm variant
(`db:migrate:test`, `db:reset:test`, `db:seed:test`, `db:verify-rls:test`,
`db:generate:test`) that loads `.env.test` instead of `.env.local`. This is the
*only* switch — there is no env-var flag a command can be run with by accident.
Concretely:
- `drizzle-kit` scripts point at a separate `drizzle.config.test.ts` via
  `--config=drizzle.config.test.ts`.
- `tsx`-run scripts (`reset.ts`, `seed.ts`, `verify-rls.ts`) require an explicit
  `--env=dev|test` argument, supplied only by the pnpm script itself — running
  the file directly without it throws.

**Hard guard:** the test project ref (`uietkphpfqaicbndunwt`) is **hardcoded** as
`TEST_PROJECT_REF` in `src/db/load-env.ts`, not read from an env var — a guard
that a forgotten/unset variable can silently disable is not a guard. Every
`:test` script/config aborts with a readable error before doing anything
destructive if the resolved connection string doesn't contain that literal.

**DB-backed test lane:** `pnpm test:db:test` runs `tests/integration/**` against this project via
`vitest.integration.config.ts` — currently the `stampSessionJoin` concurrency suite (SPEC §15). It
connects on the **session pooler** (`sessionPoolerUrl()`, :5432), not the :6543 transaction pooler,
because it holds transactions open while a second connection blocks on a row lock. `.env.test` is
loaded by the same `scripts/with-ca-certs.mjs --env-file=` wrapper the E2E lane uses, and
`assertTestProjectRef` runs twice — once at config load against the file, once against the string
actually being connected with. It creates one `bookings` row per test and deletes it in teardown;
it does **not** seed, so run `pnpm db:seed:test` first if the project is empty. **It is not in CI and
must not be added** — the runner has no Postgres and no `.env.test`, so it would fail the required
`verify` check for missing infrastructure. `pnpm test` (the DB-free unit lane) cannot pick these
files up: the two configs' `include` globs are disjoint.

**Reset:** `pnpm db:reset:test` drops and recreates the `public`/`drizzle`
schemas on the test project only (guarded as above). There is deliberately no
plain `db:reset:prod`/dev-and-prod-capable reset variant.

**Supabase Realtime sleeps on the free tier, and that is per-project.** When no clients
are connected, Supabase stops the project's Realtime tenant — the log line in the
dashboard is *"Stop tenant because of no connected users"*. Starting it again does real
work (replication slot creation, publication validation, partition creation) and **takes
longer than the browser client's connect timeout**, so the first person to load a page
that subscribes after a quiet period gets `TIMED_OUT` — or no status callback at all —
while the second load moments later succeeds. This presented as an intermittent
"instant requests don't reach the tutor" bug and cost a full investigation; see
DECISIONS, "the instant request never reached the tutor".

The client now retries with backoff (SPEC §8), so this is no longer a user-visible
failure. It is recorded here because **it is a property of the Supabase project, not of
this repository** — like the `pg_cron`/`pg_net` extensions and the Vault secrets below,
it does not travel. The Phase 10 production project will start with a cold, sleeping
tenant, and `[realtime/…] subscription TIMED_OUT` in a browser console there is expected
on the first load, not a regression. Check the project's Realtime logs before treating it
as one.

**No cron on the test project — and none is needed.** The pg_cron + pg_net
`sweep-presence` job is scheduled **only** on the shared dev/prod project
(`mipnoxlhurdbaahmvhhx`); the test project has no `cron.job` entries, no
`pg_cron`/`pg_net` extensions, and no Vault secrets. It exists for seeding and
E2E runs, which drive presence explicitly rather than relying on a background
sweep — and the sweep is tidy-up, not correctness (the `live_tutors` view
filters stale rows at read time, SPEC §3.1). Scheduling one here would also
mean a second job POSTing at the production URL. Do not add one.

**Verified end-to-end (2026-08-23):** `pnpm db:migrate:test` applied the full
0000→0014 migration chain from an empty test database cleanly — 25 tables
landed in `public` (`profiles`, `tutor_profiles`, `bookings`, `wallets`,
`credit_transactions`, etc.), no errors (only benign `DROP TRIGGER IF EXISTS
... does not exist, skipping` NOTICEs from later migrations dropping
not-yet-created triggers). `pnpm db:seed:test` then completed and populated
the test project: 11 profiles (1 admin, 8 tutors, 2 students), 8 tutor
profiles, 26 subjects, 9 platform_settings rows, 2 favourites — confirmed by
querying the test database directly, not just trusting the script's own log.

Note: `db:seed:test` calls the Supabase Admin API via `@supabase/supabase-js`,
which uses Node's `fetch` — one of the two symptoms of the machine-wide CA
issue below. See "Node's CA trust store" for the full picture; the short
version is `NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem` fixes it and this is
unrelated to the test project, credentials, or migration/seed code.

### Node's CA trust store does not complete chains the system bundle does

**This is a machine-wide property, not a Supabase quirk.** On this machine,
Node's own bundled CA trust store fails to complete TLS chains that the
system bundle at `/etc/ssl/cert.pem` (and therefore `curl`) completes without
issue. It affects **any** Node process reaching the network over HTTPS, not
just calls to Supabase.

**Two symptoms observed so far, one fix:**
- `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` — Node `fetch` against `*.supabase.co`
  (the Supabase Admin API and Auth).
- `SELF_SIGNED_CERT_IN_CHAIN` — `pnpm exec playwright install` downloading
  browsers from `cdn.playwright.dev`.

**Both hosts were verified to serve genuine certificate chains** — `curl -v`
against each returns `ssl_verify_result=0` (verified, not bypassed), and the
chains resolve to real public CAs: Google Trust Services for `supabase.co`,
DigiCert for `cdn.playwright.dev`. **This is explicitly NOT TLS interception
and NOT a VPN** — that hypothesis was investigated and disproved (no proxy env
vars set, no active VPN tunnel interface, `scutil --proxy` empty, genuine
chain presented) — so if a future symptom on a third host looks like this,
don't re-open that investigation; go straight to `NODE_EXTRA_CA_CERTS`.

**The fix, one variable:** `NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem` (or your
platform's system CA bundle path), set **before** the Node process starts —
Node reads it once at startup, so it cannot be set from inside an
already-running script.

- **`db:*` / `db:*:test` scripts:** automatic, via `scripts/with-ca-certs.mjs` (below).
- **`pnpm build` / `pnpm dev` / bare `tsx`:** not wrapped — export it manually.
- **`pnpm exec playwright install`:** not wrapped — run it as
  `node scripts/with-ca-certs.mjs pnpm exec playwright install` on a fresh
  clone. The bare command fails on this machine.
- **`pnpm test:e2e`:** wrapped internally — the `webServer.command` in
  `playwright.config.ts` runs through `scripts/with-ca-certs.mjs`.

## Checklist (fill in as the build progresses)

- [ ] Supabase project creation (dev done; prod TBD) and RLS verification steps — Phase 1.
- [ ] Vercel project + env vars per environment (values from `.env.example`).
  - **Vercel "Framework Preset" must read "Next.js"**, not "Other" — with the wrong preset
    Vercel runs the build but never applies Next's routing/output convention, so every route
    returns a platform 404 despite a clean build. See DECISIONS, "Production 404".
  - **Vercel env vars are per-project AND per-environment** (Production / Preview /
    Development) — they are NOT inherited from the repo or from `.env.local`. Each must be
    set explicitly in the Vercel dashboard for every environment that needs it.
- [x] Google OAuth consent screen and redirect URIs — Phase 3. **Done 2026-08-24.** Google Cloud
  OAuth client created (consent screen External; scopes `email`/`profile`/`openid`; authorized
  redirect URI set to the **Supabase** callback, not ours), client id + secret entered into
  Supabase → Authentication → Providers → Google, provider enabled, verified with a live
  click-through against the deployed Vercel app — sign-in completes and lands signed in. See
  "Phase 3 — Auth & onboarding" below for the exact steps and the client-ID-vs-client-name gotcha.
  **Still open:** `pnpm db:verify-rls` has not been re-run since enabling — see DECISIONS,
  "Google OAuth enabled".
- [x] PayPal app: sandbox vs live credentials, webhook registration + webhook id — Phase 5.
  **Done for SANDBOX only.** Live is Phase 10 — see the warning below.
  - **Webhook registered (sandbox).** URL `https://nowtutors-brown.vercel.app/api/webhooks/paypal`.
  - **Webhook id (SANDBOX):** `9TL802630X898090D`. This id is **sandbox-only** — a *different* id
    exists for live, and the two are not interchangeable.
  - **Subscribed events:** `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`,
    `PAYMENT.CAPTURE.REFUNDED` — exactly the three the route handles.
  - **Verified 2026-08-22:** a PayPal webhook-simulator delivery returned **200**, with signature
    verification succeeding against the real webhook id (not a stub).
  - **Env vars are set in TWO independent places, and setting one does NOT set the other.**
    `PAYPAL_WEBHOOK_ID`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID`
    and `PAYPAL_ENV` are configured in **Vercel (Production)** *and* must **also** be set separately
    in local **`.env.local`**. Vercel's dashboard and `.env.local` are unrelated stores: adding a
    variable in Vercel does not populate `.env.local`, and adding it locally does not deploy it.
    A missing local value breaks `pnpm dev`; a missing Vercel value breaks production. Set both.
  - `NEXT_PUBLIC_PAYPAL_CLIENT_ID` must match `PAYPAL_CLIENT_ID` for the environment — it is the
    same public value, used by the PayPal JS SDK on the purchase page.
  - ⚠️ **Phase 10 live cutover — the sandbox webhook id will NOT work in live.** Going live needs a
    **separate webhook registered on the LIVE PayPal app**, which issues its **own** webhook id.
    Webhook ids are per-environment and PayPal signs live deliveries against the live id only.
    **Shipping the sandbox id (`9TL802630X898090D`) to production means every live delivery fails
    signature verification and 400s** — the closed-tab backstop silently stops working while client
    capture still appears fine. The live cutover is: register the live webhook, copy its new id into
    the production `PAYPAL_WEBHOOK_ID`, and set `PAYPAL_ENV=live` with the live client id/secret.
    No code change — but it is **not** just flipping `PAYPAL_ENV`.
- [ ] **LessonSpace waiting-room setting (dashboard, not code)** — Phase 7.
- [x] **`CRON_SECRET`** set in Vercel (per environment) **and** in local `.env.local` — Phase 6
  Part 1. **Done 2026-08-23.** The value now lives in **three** stores that must stay byte-identical:
  1. **Supabase Vault** — secret name **`cron_secret`** (dev/prod project `mipnoxlhurdbaahmvhhx`).
     This is what pg_cron reads at call time; read it back with
     `select name, length(decrypted_secret) from vault.decrypted_secrets where name = 'cron_secret';`
     (expect length 64 — it is an `openssl rand -hex 32` value).
  2. **Vercel** → Project → Settings → Environment Variables → Production. Vercel only applies an
     env-var change on a **new deployment**; setting the variable alone leaves the running
     deployment on the old value.
  3. **`.env.local`** for local runs.
  As with the PayPal vars these are unrelated stores: set all three. A mismatch shows up as a
  **401** in `net._http_response`, not as a failed job; **503** means the deployment has no
  `CRON_SECRET` at all. Watch for a trailing space/newline when pasting — that is the usual cause
  of a 401 between otherwise "identical" values.
  - **Rotated and verified 2026-08-23.** The original value was exposed in plaintext (printed to a
    terminal and pasted between stores during setup) and was treated as compromised. A fresh
    `openssl rand -hex 32` was generated and applied to all three stores — Vercel (redeployed),
    `.env.local`, and the Vault `cron_secret` entry (via `vault.update_secret`) — then confirmed
    live: a bearer-token call to `/api/cron/sweep-presence` using the `.env.local` value returned
    **200**, the Vault `cron_secret` length is still 64, and `cron.job` / `net._http_response` show
    the scheduled sweep succeeding against the new value.
- [x] **pg_cron + pg_net scheduling for `/api/cron/sweep-presence`** — Phase 6 Part 1.
  **Done 2026-08-23 on the shared dev/prod project `mipnoxlhurdbaahmvhhx`.** Run
  `drizzle/snippets/pg_cron_sweep_presence.sql` **once per environment**, as `postgres`, from the
  Supabase SQL editor (it is not a migration — see the snippet's header for why). Every step needs
  the elevated `postgres` role the SQL editor uses: `create extension` and the Vault writes need
  privileges the **migration connection does not have**, so this cannot be automated through
  `drizzle-kit`/`tsx`. Steps:
  1. `create extension` for `pg_cron` (schema `pg_catalog`) and `pg_net` (schema `extensions`).
  2. `vault.create_secret` for `app_base_url` (no trailing slash) and `cron_secret`.
     `vault.create_secret` **raises on a duplicate name** — check `vault.secrets` first and use
     `vault.update_secret` to change an existing value.
  3. `cron.schedule('sweep-presence', '*/5 * * * *', …)` — the snippet unschedules first, so
     re-running it updates the job rather than duplicating it.
  4. Verify: `select jobid, jobname, schedule, active from cron.job;` then, after five minutes,
     `select status_code, content from net._http_response order by created desc limit 5;` —
     a healthy run returns `{"ok":true,"job":"sweep-presence","swept":N,…}`. **401** = the Vault
     secret and Vercel's `CRON_SECRET` disagree; **503** = `CRON_SECRET` is unset on the deployment.
  - **Verified 2026-08-23:** job scheduled and **active** (`jobid` 1, schedule `*/5 * * * *`); a
    manual `net.http_post` invocation returned **200** with `{"ok":true,…}`, confirming the Vault
    `cron_secret` and Vercel's `CRON_SECRET` agree.
  - **The full response body was not actually captured until 2026-08-25 — this job had been
    scheduled and assumed working since Phase 6 Part 1, with no more than "200 with `{"ok":true,…}`"
    ever recorded against it.** `select id, status_code, content, created from net._http_response
    where content->>'job' = 'sweep-presence' order by created desc limit 5;` (or just filter the
    general log) now shows real scheduled firings, e.g.
    `{"ok":true,"job":"sweep-presence","swept":0,"sweptUserIds":[],"pendingRequestsExpired":0,
    "agoraWarmPing":{"ok":true,"status":200,"durationMs":147},"durationMs":840}` — every five
    minutes, going back through the whole session. **`swept: 0` is the correct answer, not an
    absence of evidence:** the deployed data has no live tutors to sweep, so a zero proves the pipe
    (route reached, guard passed, response captured) rather than the sweep logic itself, which is
    what the test suites prove. Recorded here because "it's been running since Phase 6 Part 1" had
    quietly become a load-bearing assumption nothing in this file had actually verified.
  - **Target URL:** `https://nowtutors-brown.vercel.app` — the production deployment, stored in
    Vault as `app_base_url`. Not localhost, not a preview URL. (Note `nowtutors.vercel.app`,
    without `-brown`, belongs to an unrelated third party — see the DNS item below.)
  - **The job definition reads both secrets from `vault.decrypted_secrets` at call time and never
    inlines them.** `cron.job.command` is readable by anyone with database access, so a literal
    token there would leak the only thing guarding a write endpoint. Re-check after any edit with
    `select command from cron.job where jobname = 'sweep-presence';` — it must show the
    `select … from vault.decrypted_secrets` subqueries, not a 64-char hex string.
  The sweep is **tidy-up, not correctness** — the `live_tutors` view protects students at read time
  (SPEC §3.1), so a job that has not been scheduled yet is not an outage.
- [x] **pg_cron scheduling for `/api/cron/expire-requests`** — Phase 6 Part 2. **Done 2026-08-25
  on `mipnoxlhurdbaahmvhhx`.** Ran `drizzle/snippets/pg_cron_expire_requests.sql` once, as
  `postgres`, from the Supabase SQL editor, after `pg_cron_sweep_presence.sql` (already run
  2026-08-23 — same extensions and the same two Vault secrets, reused rather than re-created).
  - Schedule is `* * * * *` (§12) — a minute, not five: a 60-second request that sits `pending` for
    five minutes is visibly wrong in the tutor's inbox even though nothing incorrect follows from it.
  - **Verified 2026-08-25, and to a stronger standard than "scheduled and returns 200" alone:**
    `select jobid, jobname, schedule, active from cron.job;` shows `expire-requests` (`jobid` 3) at
    `* * * * *`, `active = true`. `net._http_response` then shows it **firing on consecutive
    minutes** — four rows in a row, `2026-08-25T01:56:00Z` through `01:59:00Z`, each **200** with
    `{"ok":true,"job":"expire-requests","expired":0,"expiredIds":[],"durationMs":172}` (durations
    172–665ms). Four consecutive firings is what confirms the schedule is actually **running**, not
    merely registered in `cron.job` — a job can show `active = true` and a single successful manual
    invocation while never once firing on its own clock; watching it land on its own cadence, twice
    or more in a row, is the check that rules that out. `expired: 0` is correct, not incomplete: the
    deployed data has no pending `session_requests` to expire, so a zero here proves delivery, not
    the expiry logic — that's the test suites' job.
  - **401** = the Vault secret and Vercel's `CRON_SECRET` disagree; **503** = `CRON_SECRET` is unset
    on the deployment.
  - Like the sweep, this job is **tidy-up, not correctness**: the accept transaction refuses (and
    terminally expires) a request past its deadline on its own, and the "one pending request at a
    time" read ignores rows past theirs, so an unscheduled job is not an outage.
- [x] **pg_cron scheduling for `/api/cron/complete-sessions`** — Phase 6 Part 3C. **Done
  2026-08-25 on `mipnoxlhurdbaahmvhhx`.** Ran `drizzle/snippets/pg_cron_complete_sessions.sql`
  once, as `postgres`, from the Supabase SQL editor, after `pg_cron_sweep_presence.sql` (already
  run 2026-08-23 — same extensions and the same two Vault secrets, `app_base_url` and
  `cron_secret`, reused rather than re-created).
  - Schedule is `*/15 * * * *` (§12).
  - **Verified 2026-08-25, both halves.** *Scheduling:* `select jobid, jobname, schedule, active
    from cron.job;` shows `complete-sessions` (`jobid` 2) at `*/15 * * * *`, `active = true`,
    alongside `sweep-presence` (`jobid` 1). *That it actually works:* a manual `net.http_post`
    invocation returned request id 506, and `select status_code, content from net._http_response
    where id = 506;` shows **200** with
    `{"ok":true,"job":"complete-sessions","completed":0,"noShowTutor":0,"noShowStudent":0,
    "earningsCreated":0,"earningsSkippedNoPrice":0,"completedIds":[],"noShowTutorIds":[],
    "noShowStudentIds":[],"earningsCreatedIds":[],"earningsSkippedNoPriceIds":[],
    "durationMs":636}`. **This was the first cron in the deployed app proven working end to end** —
    at the time this was written, `sweep-presence` and `expire-requests` were verified only as
    scheduled and returning *some* 200, with no specific-invocation-to-specific-response trace on
    record for either. Both have since been closed to the same standard: see `sweep-presence`'s
    "full response body was not actually captured until 2026-08-25" note and `expire-requests`'s
    consecutive-minute-firing verification, both above. All three crons this repo has built are now
    verified to the same evidentiary standard — a captured request/response pair, not a description
    of one.
  - **`pg_net.http_post` returns a request id, not a status code — the call itself always
    "succeeds."** `select net.http_post(...)` hands back an integer (`506` above) the instant the
    request is queued; it says nothing about what the target route returned. The actual
    `status_code` and `content` land asynchronously in `net._http_response`, keyed by that same id.
    Reading `net.http_post`'s return value as if it were the HTTP result is the mistake this note
    exists to prevent — always join back to `net._http_response` by request id (or, for a scheduled
    job, filter by `created desc` immediately after the schedule fires).
  - **Unlike the other two jobs, this one was NOT tidy-up while unscheduled.** `sweep-presence` and
    `expire-requests` sit on top of correctness enforced elsewhere; `complete-sessions` is the
    **only** writer of `tutor_earnings` in the codebase (§7.11), and nothing else in the deployed
    app transitions a `confirmed`/`in_progress` booking to `completed` or a no-show status when both
    parties have walked away from a session (SPEC §12, docs/DECISIONS.md, Phase 6 Part 3C). Before
    this was scheduled, no tutor was ever paid for a session nobody was left to close, and those
    bookings sat `confirmed`/`in_progress` indefinitely. The four Part 3B server-side actors
    (`getSessionState`, the token route, `endSession`, the room's server read) still close an
    instant session while a participant is present; now that this job is scheduled, the
    both-parties-offline case and every no-show resolve too.
  - **The Vault dependency, plainly.** This snippet — like `expire-requests`'s — reads
    `app_base_url` and `cron_secret` from `vault.decrypted_secrets` at call time; both are created
    once by `pg_cron_sweep_presence.sql` and reused, never re-created (`vault.create_secret` raises
    on a duplicate name). **The snippet itself contains no secret and no placeholder** — every
    value it needs comes from a `select … from vault.decrypted_secrets where name = '…'` subquery,
    never a literal. `app_base_url` must have **no trailing slash** (it is concatenated directly
    with the route path, e.g. `'/api/cron/complete-sessions'`; a trailing slash would double it).
  - **The rotation trap this creates: `cron.job.active = true` says nothing about whether the
    secret it's using still matches.** If `CRON_SECRET` is rotated in Vercel without also running
    `vault.update_secret` on the Vault's `cron_secret` entry, the job keeps firing on schedule,
    keeps showing `active = true` in `cron.job`, and every single run returns **401** in
    `net._http_response` — a silent failure that looks identical to a healthy, idle job unless
    someone reads the response body. There is no dashboard state that surfaces this on its own;
    checking `cron.job` alone is not enough. **Whenever `CRON_SECRET` is rotated, `vault.update_secret`
    on `cron_secret` is not optional cleanup — it is the other half of the rotation**, and the
    verification is not "the job is active" but "the last `net._http_response` for this job is 200."
- [x] **`CRON_SECRET` rotated.** The value set on 2026-08-23 during initial setup was exposed in
  plaintext (printed to a terminal, pasted between stores) and has been rotated and verified
  2026-08-23 across all three stores. See the `CRON_SECRET` item above for detail. This closed the
  rotation gate — scheduling `pg_cron_expire_requests.sql` and `pg_cron_complete_sessions.sql`
  were, at that point, still separate actions; the latter is now done (above).
  - **Re-verified live against `/api/cron/complete-sessions` specifically, 2026-08-25** (Phase 6
    Part 3C, before this route had ever been scheduled or called in production): an
    **unauthenticated** GET to the deployed route returned **401** — `{"error":"Unauthorized."}`,
    not the 503 an unset `CRON_SECRET` would produce. A 401 on a request carrying no valid bearer
    token confirms two things at once: the guard (`cronAuthFailure`, shared by every cron route) is
    actually wired into this handler, and `CRON_SECRET` reached the production environment rather
    than being unset there. The secret's **value** is not recorded anywhere in the repository, this
    file included — only the outcome of the check is. This is the same class of verification the
    `sweep-presence` item above performs for its own route; `complete-sessions` had not been checked
    live until now because the route did not exist before Phase 6 Part 3C.
  - **Rotated a SECOND time, 2026-08-25, after the value was pasted in plaintext into a chat
    session** — the same exposure mode as 2026-08-23, a different value. **Verified both directions,
    live, 2026-08-25, not merely asserted:** the specific value that had been exposed in chat now
    returns **401** when sent as `Authorization: Bearer <that value>`, confirming it is dead; a
    plain unauthenticated GET also returns 401 (the guard is still active, not disabled); and the
    scheduled `complete-sessions` job's most recent `net._http_response` is **200** — which is only
    possible if the Vault's current `cron_secret` matches whatever the deployed app is checking
    against. Together these three facts are sufficient to close this item without needing to inspect
    Vercel's or `.env.local`'s state directly: a value that is simultaneously dead when presented and
    live when the scheduled job uses it *is* a confirmed rotation, by definition of what "rotated" has
    to mean here — this is exactly the rotation-trap check the note on the `complete-sessions`
    scheduling item above describes, run against the live system rather than assumed. As before, no
    value — old or new — is recorded in this file or anywhere else in the repository; only the
    outcome of each check is.
- [ ] Agora project settings and token-service health check — Phase 6 **Part 3** (still unticked;
  Part 1 built presence only, and the §12 warm-ping to the Render token service is a
  `TODO(Phase 6 Part 3)` in the sweep handler).
- [ ] Resend domain verification and DNS records — Phase 10.
- [ ] DNS cutover for nowtutors.com — Phase 10.
  - **`nowtutors.vercel.app` (no `-brown`) belongs to an unrelated third party. Do NOT point
    nowtutors.com at it.**
- [ ] **⚠️ LAUNCH BLOCKER — move production off the DEV Supabase project — Phase 10, BEFORE
  launch.** **Verified 2026-08-24: the deployed Vercel app currently authenticates against Supabase
  project `mipnoxlhurdbaahmvhhx`** — dashboard title **"nowtutors-dev"** — confirmed live, not
  inferred from config. Production is running on the development project today. This is acceptable
  only while there are no real users; it is not a general aspiration to clean up eventually. Create a
  dedicated production project, run the migrations against it, seed `platform_settings` + subjects
  (NOT the dev fixtures), promote the first admin by SQL, repoint the Vercel production env vars
  (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `DATABASE_URL`, `DIRECT_URL`), redo the Google OAuth redirect URIs and the same-email linking
  setting for the new project, and re-run `pnpm db:verify-rls` against it. See DECISIONS,
  "Production 404".
  - **All three `drizzle/snippets/pg_cron_*.sql` files must be run again on the new project.**
    `cron.job`, the Vault secrets, and everything scheduled from them are **per-project state** —
    none of it is carried by a migration, and none of it follows the app when
    `NEXT_PUBLIC_SUPABASE_URL` and friends get repointed. As of 2026-08-25 every snippet that
    exists (`pg_cron_sweep_presence.sql`, `pg_cron_expire_requests.sql`,
    `pg_cron_complete_sessions.sql`) has been run and verified live on `mipnoxlhurdbaahmvhhx` — a
    fresh production project starts with none of that. **Run `pg_cron_sweep_presence.sql` first, on
    the new project, exactly as on this one**: it creates the `pg_cron`/`pg_net` extensions and the
    two Vault secrets (`app_base_url`, `cron_secret`) the other two snippets read by name and do not
    re-create — running either of the other two first fails outright, since their
    `vault.decrypted_secrets` lookups find nothing. `app_base_url` on the new project must point at
    whatever URL is now serving production, not at `nowtutors-brown.vercel.app`.
- [ ] First-admin promotion SQL — Phase 1/8.
- [ ] Rollback procedure.

## Local setup notes

- Package manager: **pnpm** (`corepack` or `npm i -g pnpm`).
- Copy `.env.example` → `.env.local` and fill values.
- `pnpm install` → `pnpm db:migrate` → `pnpm dev`.
- All `db:*`/`db:*:test` scripts run through `scripts/with-ca-certs.mjs`, which
  automatically sets `NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem` for that command
  when the var isn't already set and that file exists — the fix for
  `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` (Node's own CA bundle missing an issuer
  cert that the system trust store, e.g. `curl`, already has) is now automatic
  for both dev and test db scripts. It's a silent no-op on machines that don't
  need it (this cannot live in `src/db/load-env.ts` — `NODE_EXTRA_CA_CERTS` is
  read by Node once at process startup, before any application code runs, so
  it must be set before the `tsx`/`drizzle-kit` process is even spawned).
  **Fallback:** if your system CA bundle is at a different path, export
  `NODE_EXTRA_CA_CERTS=<path-to-your-bundle>` yourself before running the
  script — an already-set value is left untouched. This is a local-machine
  quirk only; CI and Vercel are unaffected.

### Running the E2E suite

`pnpm test:e2e` boots its **own production build** and serves it —
`playwright.config.ts`'s `webServer.command` runs
`node scripts/with-ca-certs.mjs --env-file=.env.test sh -c 'pnpm build && pnpm start'`,
so the CA fix and the test-project env are both applied automatically; no
manual export needed for this command specifically.

- **`reuseExistingServer` is `false`, deliberately.** A stray `pnpm dev`
  already running on `:3000` is pointed at the dev/prod project — reusing it
  would silently run the whole suite (presence writes, session requests,
  wallet reads) against the database that serves production. A port clash is
  a loud, correct failure; a silently wrong database is not. If the suite
  reports the port is busy, find and stop whatever is listening on it before
  retrying — do not relax this setting.
- **Requires the test project seeded first:** `pnpm db:seed:test` (see "Test
  Supabase project" above). The suite drives real sign-ins against
  `tutor1@nowtutors.dev` / `student1@nowtutors.dev`.
- **Why a production build and not `next dev`:** under `next dev` every route
  compiles on first request, which inflated every timeout in the spec into
  latency cover rather than a real budget. See `playwright.config.ts`'s own
  header comment for the measured numbers.

## Phase 3 — Auth & onboarding (Supabase Auth + Google OAuth)

**Supabase dashboard → Authentication → URL Configuration**
- **Site URL — current value: `https://nowtutors-brown.vercel.app`.** ⚠️ **Must be updated whenever
  the deployed origin changes.** This project has only **one** Site URL for both local dev and the
  deployed app; a confirmation/reset email's action link is built from it. Left at
  `http://localhost:3000` after a deploy, it produces a confirmation email that opens fine for the
  developer and is **dead for every real user, with no error surfaced anywhere** — this is exactly
  what happened 2026-08-24 (see DECISIONS, "Google OAuth enabled; signup 'no confirmation email'
  misdiagnosed as a code defect") and cost a full misdiagnosis before the actual cause (this setting)
  was found. Local dev keeps working only because `localhost:3000/auth/callback` is separately
  allow-listed below — a fallback link lands on the **deployed** app, not localhost, which is an
  accepted trade-off (see DECISIONS), not a bug.
- **Redirect URLs (allow-list) — current values:**
  - `http://localhost:3000/auth/callback`
  - `https://nowtutors-brown.vercel.app/auth/callback`
  - `https://*.vercel.app/auth/callback`
  Supabase only redirects back to allow-listed URLs — anything else is silently dropped and the
  request falls back to the Site URL root (`/?code=...`), which has no code-exchange handler and
  leaves the user signed out with no error. Our code always sends `redirectTo`/`emailRedirectTo` =
  `${origin}/auth/callback` (OAuth, email confirmation → `?next=/onboarding`, password reset →
  `?next=/reset-password`).

**Google OAuth (Google Cloud Console → APIs & Services) — DONE, completed 2026-08-24.**
- **OAuth consent screen:** External; app name, support email, logo; scopes `email`,
  `profile`, `openid`; add test users while unverified.
- **Credentials → OAuth 2.0 Client ID (Web application):**
  - **Authorized JavaScript origins:** the app origins (localhost + preview + prod).
  - **Authorized redirect URI:** the **Supabase** callback, not ours —
    `https://<project-ref>.supabase.co/auth/v1/callback` (Google returns to Supabase,
    which then returns to our `/auth/callback`).
- Put the Client ID + secret into **Supabase → Authentication → Providers → Google**
  and enable it.
- ⚠️ **The Client IDs field in Supabase's Google provider panel takes the long Google
  client id ending in `.apps.googleusercontent.com` — NOT the human-readable name you
  gave the OAuth client in Google Cloud Console.** Entering the name instead of the id
  saves without error and silently produces a client Google will not recognise; the
  failure only shows up at the `/authorize` step. This cost real time during setup —
  copy the id-shaped value, not the console's display name.
- **Verified 2026-08-24** by a live click-through against the deployed Vercel app:
  Google sign-in completes and lands the user signed in.

**Account linking (the Google-on-existing-email case — SPEC §7.1)**
- Enable **Authentication → Providers → "Allow linking accounts with the same email"**
  (automatic same-email identity linking). Then a Google sign-in whose email matches an
  existing **confirmed** password account resolves to the **same** auth user — no
  duplicate. Our `profiles` row is keyed by the auth user id and created once by the
  `on_auth_user_created` trigger (`ON CONFLICT DO NOTHING`), so linking never duplicates a
  profile, and `/auth/callback` adds no profile row.
- **Security note:** automatic linking only fires when the pre-existing email is
  **verified**. If the password account is unverified, Supabase creates a **separate**
  identity rather than linking (prevents account takeover of an unconfirmed address).
  This is intended.

**Email templates & confirmation (Authentication → Email Templates / Providers)**
- **Confirm signup, Reset password, Magic link:** ensure the action link points at
  `{{ .SiteURL }}/auth/callback` (append `?next=/onboarding` for confirm, `?next=/reset-password`
  for recovery) so the code lands on our handler.
- The built-in Supabase SMTP sender is **rate-limited (~a few/hour)** — fine for dev
  only. For real signups configure a custom SMTP / Resend (Phase 10). For dev you may
  turn **"Confirm email" OFF** so `signUp` returns a session immediately and routes
  straight to `/onboarding`; with it ON, signup shows a "check your email" state.
  **Confirmed 2026-08-24: the limit bites after a handful of sends per hour** —
  repeated signup testing against the built-in sender hits `HTTP 429
  over_email_send_rate_limit` and becomes self-blocking well before an hour of normal
  manual testing is up. This is the concrete reason Resend (Phase 10) is the fix, not
  just a "nicer sender" upgrade — it's what unblocks testing the signup flow at all
  without waiting out the window.
- Password minimum length / leaked-password protection can be tightened in
  **Authentication → Policies**; our client+server zod schema already requires ≥8 chars
  with a letter and a number.

### Same-email account linking — automated check

`pnpm db:verify-rls` asserts this rather than trusting the dashboard: it creates a
probe user, tries to create a **second** account with the same email, and requires
that attempt to be **rejected** (then deletes both). That is the observable form of
the SPEC §7.1 no-duplicate-accounts guarantee.

The dashboard flag itself (**Authentication → Sign In / Providers → "Allow multiple
accounts with the same email address"**, which must stay **OFF**) is only readable
through the Supabase **Management API**, which needs a personal access token we
deliberately do not ship in app env — hence asserting the consequence instead.

If that check fails, the setting has been turned on: Google sign-in on an existing
email will create a **second account** instead of linking to the existing one. Fix
it in the dashboard, then re-run `pnpm db:verify-rls`. Run this against **each**
environment (dev, and production before launch) — it is a per-project setting.
