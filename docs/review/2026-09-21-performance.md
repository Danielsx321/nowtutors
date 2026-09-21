# NowTutors performance review

Measured 2026-09-21, `main` at 0184023. Read-only: no file in `src/`, `drizzle/` or `tests/` was changed. Nothing here is fixed yet; this is for triage.

## The short version

The database is fast and the query count is not what makes production slow. Every statement the pages run finishes in under half a millisecond, and in production the functions sit next to the database, so 7 statements and 18 statements cost about the same. The handoff guessed that sequential queries were the most likely win. The numbers say otherwise.

What the numbers do show, worst first:

1. Signed-in pages answer about 0.3 to 0.4 s slower than signed-out pages in production, and that gap does not move with the number of queries. The likely cause is that every request checks the session with Supabase Auth over the network twice.
2. The home globe draws four times more pixels than the screen has. On a retina laptop the drawing surface is 4400 x 4400. It also keeps drawing when it is scrolled out of view.
3. The logo is a 34 KB path, and each page carries four copies of it. That is about 136 KB of the 167 KB `/login` HTML, on every page, and no page is cacheable.
4. One page view sets off 8 to 19 background prefetches plus 2 to 4 server actions. Each one runs the auth check and re-renders the layout. A student dashboard needs 14 statements to render and then runs 20 more in the background.
5. Every signed-in page repeats 1 to 5 statements it already ran. `/tutor` runs 20 where about 13 would do.

Bundles are healthy. Indexes are missing in five places but none matter at launch size.

## How this was measured

| What | How | Trust |
|---|---|---|
| Statements per page | Production build of `main` run locally against the test project (`uietkphpfqaicbndunwt`). `pg_stat_statements` reset before each page, read after. Once for the HTML alone (one render), once for a full browser load plus 5 s (render plus everything the page does after mount). Seeded fixture accounts, signed in the way the E2E specs do. | High. Counted by Postgres, not by reading code. |
| Statement timing | `mean_exec_time` from the same view | High for the test project's 11 profiles and 14 bookings. Says nothing about large tables. |
| Where the statements come from | Two read-only code traces (student and public pages, tutor and admin pages) | High; line numbers below. The traces under-counted by about 2 per page, so the measured figures are the ones to use. |
| Production, signed out | `curl` from Lagos, VPN off, 4 runs per page | Good for the Lagos path. Edge was `cpt1`, function `cdg1`. |
| Production, signed in | Page fetches from Daniels' own Chrome, already signed in as admin, warm connection, 3 to 5 runs per page. Page loads only. | Good for the Lagos path. Admin only; student and tutor dashboards not timed in production. |
| Globe | Live home page in a real browser window with a hardware GPU (Intel Iris Plus), plus the `cobe` 2.0.1 source | The buffer size is certain. Frame rates were not usable: the Mac was at load 80 and the pane was throttled. |
| Bundles | `next build` output | High |
| Indexes | `EXPLAIN` with `enable_seqscan = off` on the test project, plans only | High for "no index exists". The tables are too small for plan costs to mean anything. |

Local response times were not usable and are not quoted. Lagos to the Paris pooler is 130 ms per round trip and the Mac was overloaded, so the same page took 1.6 s, 3.4 s and 7.0 s on three consecutive runs.

## Statements per page (test project, measured)

"Repeated" counts statements that ran more than once inside one render. "After mount" is what ran in the 5 s after the page loaded: heartbeat, unread count, incoming requests, and the layouts re-rendered by link prefetches.

| Viewer | Page | Render | Repeated | After mount | Prefetches | Server actions | HTML KB |
|---|---|---|---|---|---|---|---|
| signed out | `/` | 8 | 2 | 0 | 4 | 0 | 281 |
| signed out | `/tutors` | 7 | 1 | 0 | 10 | 0 | 265 |
| signed out | `/tutors/[slug]` | 11 | 2 | 0 | 5 | 0 | 200 |
| signed out | `/live` | 3 | 1 | 0 | 4 | 0 | 167 |
| signed out | `/login` | 2 | 1 | 3 | 5 | 0 | 167 |
| student | `/dashboard` | 14 | 4 | 20 | 9 | 2 | 148 |
| student | `/dashboard/wallet` | 11 | 2 | 20 | 8 | 2 | 127 |
| student | `/dashboard/bookings` | 8 | 1 | 21 | 8 | 2 | 116 |
| student | `/dashboard/messages` | 8 | 1 | 20 | 8 | 2 | 113 |
| student | `/dashboard/favourites` | 8 | 1 | 21 | 8 | 2 | 126 |
| student | `/` | 11 | 3 | 4 | 5 | 0 | 281 |
| student | `/tutors` | 10 | 2 | 4 | 11 | 0 | 266 |
| student | `/tutors/[slug]` | 16 | 3 | 4 | 6 | 0 | 221 |
| tutor | `/tutor` | 20 | 4 | 13 | 9 | 4 | 139 |
| tutor | `/tutor/bookings` | 11 | 1 | 12 | 9 | 4 | 117 |
| tutor | `/tutor/earnings` | 12 | 1 | 13 | 9 | 4 | 120 |
| tutor | `/tutor/withdrawals` | 14 | 1 | 11 | 9 | 3 | 118 |
| tutor | `/tutor/messages` | 11 | 1 | 13 | 9 | 4 | 113 |
| tutor | `/tutor/availability` | 12 | 1 | 14 | 9 | 4 | 136 |
| admin | `/admin` | 18 | 5 | 5 | 9 | 0 | 149 |
| admin | `/admin/bookings` | 7 | 1 | 5 | 19 | 0 | 158 |
| admin | `/admin/users` | 6 | 1 | 5 | 19 | 0 | 141 |
| admin | `/admin/tutors` | 9 | 3 | 5 | 9 | 0 | 121 |
| admin | `/admin/withdrawals` | 8 | 1 | 5 | 9 | 0 | 112 |
| admin | `/admin/payments` | 5 | 1 | 5 | 9 | 0 | 114 |

Slowest statements seen: the two `last_seen_at` updates from the heartbeat at 31 and 36 ms. Every read was under 3 ms and most were under 0.2 ms.

## Production response times from Lagos

| Viewer | Page | Statements | Time to first byte |
|---|---|---|---|
| signed out | `/login` | 2 | 0.60 to 0.72 s, of which 0.17 s is the TLS handshake |
| signed out | `/live` | 3 | 0.62 to 0.70 s |
| signed out | `/tutors` | 7 | 0.65 to 0.73 s |
| signed out | `/` | 8 | 0.62 to 0.89 s |
| signed out | `/tutors/[slug]` | 11 | 0.64 to 0.82 s |
| admin, warm connection | `/live` | 4 | 0.73 to 0.97 s |
| admin, warm connection | `/admin/tutors` | 9 | 0.60 to 1.01 s |
| admin, warm connection | `/admin/withdrawals` | 8 | 0.75 to 0.89 s |
| admin, warm connection | `/tutors` | 10 | 0.76 to 0.89 s |
| admin, warm connection | `/admin/bookings` | 7 | 0.74 to 1.56 s |
| admin, warm connection | `/admin` | 18 | 0.68 to 1.01 s |
| admin, warm connection | static chunk from the edge | 0 | 0.23 to 0.40 s |

Signed out, 2 statements and 11 statements land within 0.1 s of each other, so the statement count is not the cost. The signed-out curl figures include a fresh TLS handshake and the signed-in ones do not, so on equal terms signed-out is about 0.45 to 0.55 s and signed-in about 0.75 to 0.95 s. Signed in, `/live` with 4 statements is as slow as `/admin` with 18.

One `/admin/users` request out of 35 took 10.3 s. See P11.

## Findings, by measured impact

| # | Priority | Finding | Where | Evidence | Confidence |
|---|---|---|---|---|---|
| P1 | High | The session is checked with Supabase Auth over the network twice per request | `src/lib/supabase/middleware.ts:36`, `src/lib/auth/guards.ts:27`; matcher at `src/middleware.ts:11-13` | Signed-in pages are 0.3 to 0.4 s slower than signed-out ones in production whatever they query. Middleware calls `getUser()`, then the render calls it again; React `cache()` can't span the two. The matcher also covers `/api/*`, server actions and prefetches, so the heartbeat and every background request pay it too. | Gap: measured. Cause: inferred from the code, not instrumented. Middleware runs at the edge nearest the visitor (`cpt1` for Lagos) while Auth is in Paris, which would explain why this one call is so expensive. |
| P2 | High | The globe's drawing surface is 4x too large | `src/components/features/home/globe.tsx:80-87`, `:105-108` | `sizeOf()` multiplies the CSS width by `dpr`, and `devicePixelRatio: dpr` is passed as well. `cobe` 2.0.1 does `canvas.width = width * devicePixelRatio`, so the ratio is applied twice. Live reading on production: canvas 1100 CSS px, `dpr` 2, buffer 4400 x 4400 (19.4 M pixels a frame; 2200 x 2200 is what the screen can show). On a phone: about 2028 x 2028 instead of 1014 x 1014. | Certain. Read from the live canvas and the library source. |
| P3 | Medium | The globe never stops drawing | `globe.tsx:113-118` | The `requestAnimationFrame` loop has no `IntersectionObserver`, so the shader runs at full size while the visitor reads the rest of the home page. About half the globe is cropped by the hero at 1024 wide and is still shaded. | Certain from the code. Real-device frame cost not measured (see method). |
| P4 | Medium | The logo is about 136 KB of every page | `src/components/layout/wordmark-paths.ts` (36 KB), used by `site-header.tsx:54`, `site-footer.tsx:60`, `sidebar.tsx:214`, `app-shell.tsx:90` | The path is 33,824 characters. It is rendered twice per page and each copy appears again in the React payload, so four copies. `/login` is 167 KB of HTML, 62 KB gzipped, and most of that is the logo. gzip can't fold the copies together because the path is longer than its 32 KB window. Pages are `no-store`, so it is re-sent on every navigation. | Certain. |
| P5 | Medium | One page view sets off 10 to 20 background requests | Every `<Link>` in the shells and tables (none sets `prefetch={false}`); `src/hooks/use-unread-count.ts:49,66`; `src/components/features/tutor/incoming-requests.tsx:148,180` | A student dashboard load makes 9 prefetches, 2 server actions and a heartbeat: 12 extra function calls, 20 extra statements, and an auth check on each. Admin tables prefetch every row link (19). The unread count and the incoming-requests list are each fetched twice, once on mount and again when the realtime channel reports `SUBSCRIBED`. | Measured. |
| P6 | Medium | Statements repeated inside one render | See the list below | 1 to 5 per page. | Measured. |
| P7 | Medium | `/tutor` can ask for more connections than the pool has | `src/app/(tutor)/layout.tsx:35-39`, `src/app/(tutor)/tutor/page.tsx:70-98`, `src/db/index.ts:36` | The layout runs 5 statements in parallel and the page 7, and with `max_pipeline: 0` each holds its own connection. 12 against `max: 10` for one visitor. The tutor profile page runs 9 wide. Two tutors loading the dashboard together will queue. | Inferred from the code. Not load-tested. |
| P8 | Low | N+1 on the admin tutor queues | `src/db/queries/admin-tutors.ts:53-57`, called from the unbounded queries at `:64` and `:80` | One `getTutorSubjects` per row, all in parallel. Measured at 3 statements with 3 tutors in the queue. Affects `/admin` and `/admin/tutors`. | Measured. |
| P9 | Low | Lists with no limit | `src/db/queries/bookings.ts:255` (`getBookingsForParticipant`, on `/dashboard`, `/tutor` and both bookings pages); the pending and changed tutor queues; admin withdrawals capped at 100 with no paging | Fine today, grows with every booking. | Certain from the code. |
| P10 | Low | No page can be cached | `dynamic = "force-dynamic"` on every route, including `/login`, `/signup`, `/forgot-password` and the 404 | Every response is `private, no-store`, `x-vercel-cache: MISS`. The header shows the viewer, so public pages render per visitor. A visitor far from Paris pays the full trip for pages that are the same for everyone. | Certain. The fix is structural, so this is a launch decision, not a quick win. |
| P11 | Watch | One production request took 10.3 s | `/admin/users`, 1 of 35 requests | The other three runs were 0.76 to 0.94 s. 10 s is `connect_timeout` in `src/db/index.ts`, so this looks like one database connection attempt that timed out and was retried. Seen once. | Suspicion. Check Sentry and the Vercel logs for that minute (2026-09-21, about 00:55 WAT) before acting. |
| P12 | Low | Heartbeat updates are 100x slower than reads | `src/db/queries/presence.ts:26`, `:33` | 31 and 36 ms each on the test project against under 0.5 ms for reads. Each tutor beat is two updates in sequence, every 30 s per open tab. Likely the guard triggers plus commit cost. Not a page-speed issue. | Measured on test only. |
| P13 | Low | Five lookups have no index | `tutor_earnings.tutor_id`; `conversations.participant_a` / `participant_b` (the unique index is on `LEAST/GREATEST`, which an `OR` lookup can't use); `withdrawal_requests.tutor_id` (only the partial open-request index exists); `payments.user_id` and `payments.status`; `audit_log.created_at` | Postgres confirmed no usable index for each. Irrelevant until these tables hold thousands of rows. The browse, bookings, notifications, messages and session-request lookups all have indexes. | Certain. |
| P14 | None | Bundles are fine | `next build` | 103 KB shared. Dashboards 117 to 137 KB first load, home 124 KB. `cobe` is lazy-loaded as intended and Agora stays out of first load. Heaviest: `/onboarding` 283 KB, `/tutor/profile` 266 KB, `/tutors/[slug]` 234 KB, `/login` and `/signup` 221 KB. About 59 KB gzipped of that is the Supabase browser client and 30 KB is zod. `/dev/kitchen-sink` (362 KB) ships to production. | Measured. |

### P6 detail: what runs more than once in a render

| Statement | Times | Pages | Where |
|---|---|---|---|
| Live tutor count | 2, and 3 on `/` | Every public page and every dashboard that shows it | `src/components/layout/site-shell.tsx:23`, `src/app/(public)/page.tsx:48`, dashboard pages; `getLiveTutorCount` is not wrapped in `cache()` |
| Shell identity (`display_name`, `avatar_url`) | 2 | Every signed-in page | `src/db/queries/shell.ts:17` |
| The viewer's `profiles` row, three different selects | 3 to 4 | Every signed-in page | `guards.ts:68` (role), `shell.ts:17` (name, avatar), and a timezone select in each page (`dashboard/page.tsx:68`, `wallet/page.tsx:64`, `bookings/page.tsx:20`, `inbox-view.tsx:25`, `tutor/page.tsx:71`, `admin/page.tsx:63` and others). One wider select in the cached `getSessionProfile` removes 2 to 3 statements from every signed-in page. |
| Wallet balance | 2 | `/dashboard`, `/dashboard/wallet` | `(student)/layout.tsx:26` and the page |
| `getStudentTutors` / `getTutorStudents` (a CTE) | 2 | `/dashboard`, `/tutor` | Layout asks for 3, the page asks for 4 |
| `getTutorLiveState` | 2 | `/tutor` | `(tutor)/layout.tsx:36`, `tutor/page.tsx:89` |
| `getTutorBySlug` | 2 | `/tutors/[slug]` | `generateMetadata` at `:46` and the page at `:85`, with different arguments, so `cache()` alone won't merge them |
| Tutor subjects | 2 | `/tutors/[slug]` | `src/db/queries/tutor-profile.ts:43` and `src/db/queries/bookings.ts:133` |
| Approval status | 1, uncached | Every tutor page | `guards.ts:125`, on top of the other `tutor_profiles` reads |

## What I'd fix, in order

1. **P2 and P3, the globe.** Pass the CSS width to `cobe` and let it apply the ratio, and pause the loop when the canvas leaves the viewport. Two small edits in one file, 4x less GPU work on the first thing every visitor sees.
2. **P4, the logo.** Serve it as one static SVG file (cached forever) painted with a CSS mask so `currentColor` still works, or re-trace it to a few KB. Takes roughly 40 KB off the wire on every page.
3. **P1, the double auth check.** Supabase's `getClaims()` verifies the token locally when the project uses asymmetric signing keys, which removes both network calls. Check the project's JWT key type first. If it is still on the legacy secret, the smaller step is to keep `getUser()` in the guards (which run in `cdg1`, next to Auth) and have middleware only refresh a token that is close to expiry. Before either, confirm the split with a `Server-Timing` header on a preview deployment. This touches auth, so it starts as a failing test like the review fixes did.
4. **P5, background requests.** `prefetch={false}` on the sidebar, bottom bar and table row links (hover prefetch still works), and drop the second fetch on `SUBSCRIBED` unless the channel reconnected.
5. **P6 and P7 together.** Widen `getSessionProfile`, wrap `getLiveTutorCount` and `getTutorLiveState` in `cache()`, pass the layout's wallet and students down instead of re-querying. Brings `/tutor` from 20 statements to about 13 and under the pool limit.
6. **P8, P9.** One grouped subjects query for the admin queues; a limit on `getBookingsForParticipant`.
7. **P13.** One migration with five indexes, any time before real volume.

P10 and P11 are decisions and watching, not fixes.

## Not measured

- Student and tutor dashboards in production (only admin was signed in). The test-project counts cover them; the production timing does not.
- Real-device frame cost of the globe. Needs a quiet machine and a phone.
- Anything under concurrent load. P7 is from reading the code.
- Visitors outside Lagos. Someone in Europe will see much smaller numbers for everything except P2 to P4.
- The session room, classroom and broadcast pages.

The harness (page list, statement counter, index check, raw results) is in the workspace at `outputs/nowtutors/performance-2026-09-21/`, so the same run can be repeated after the fixes.
