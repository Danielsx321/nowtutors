# Pass 4: Third-party boundaries

Reviewed 2026-09-20 against `main` at 9775408. Read-only. Files read: `lib/agora/{token-service,token-request,uid,session-access}.ts`, `api/agora/token/route.ts`, `lib/lessonspace/{client,session-access}.ts`, `api/lessonspace/join/route.ts`, `lib/supabase/admin.ts`, `lib/paypal/client.ts` (timeouts and headers), every `NEXT_PUBLIC_` reference, and every `"use client"` file that imports from `@/db`, the Supabase server or admin clients, or a third-party client module.

What held up: no Agora token is minted outside `POST /api/agora/token`; the browser never sees the Render URL (`AGORA_TOKEN_SERVICE_URL` is server-only and `token-service.ts` is marked `server-only`). The only public env vars are the Supabase URL and anon key, the PayPal client id, the Agora app id and the Sentry DSN, all of which are meant to be public. The service-role key is read in one place (`lib/supabase/admin.ts`, `server-only`) and imported only by `actions/messaging.ts`, the seed and `verify-rls`. The seven client components that import from `@/db/queries/*` import types only. LessonSpace join checks participation, booking type, status and the join window before it calls LessonSpace, and the API key never leaves the server. No database transaction is held open across a call to PayPal, Agora or LessonSpace, so a slow third party cannot pin a pooled connection or leave money half-written. A PayPal outage at capture leaves the payment `created` with the webhook as backstop; an Agora or LessonSpace outage returns 502 or 503 and changes no booking or ledger state.

## Confirmed by reading

### T1. Session tokens are wildcard-uid and last an hour whatever the session length. LOW
- `src/lib/agora/token-request.ts:3` and `:7-14`.
- Every token is requested for uid `0` (valid for any uid) with a 3,600 second expiry. The route returns `agoraUid(user.id)` for the client to use, but the token does not bind it, so a participant can join under the other party's uid. More relevant to money: SPEC 7.4 says the hard stop removes unbilled tutoring "by construction". The server stops issuing tokens at the deadline and the honest client leaves, but a token issued at minute 1 of a 30-minute session stays valid until minute 60. Two participants who simply do not leave (a patched client, or the SDK kept alive in a console) keep the channel for up to 30 unpaid minutes. Capping the TTL at the time remaining would make the claim true.

### T2. The Render token service accepts unauthenticated requests. MEDIUM
- `src/lib/agora/token-service.ts:49-60`: the request is a bare `GET {AGORA_TOKEN_SERVICE_URL}/rtc/{channel}/{role}/uid/0/?expiry=3600` with no credential of any kind.
- SPEC 3.7 says the service is "reused as-is" from the Bubble app, where the browser calls it directly, so its URL is visible to anyone who opens the live Bubble site's network tab. Whoever has that URL can mint a publisher token for any channel whose name they know. Session channels are `session_{bookingId}` (unguessable), but broadcast channels are `broadcast_{broadcastId}` and broadcast ids are in public `/live/[broadcastId]` URLs. SPEC 3.7's "Agora tokens are authorized" holds for this app's route and not for the service behind it.
- Confidence: high that this app sends no credential. That the service is reachable from outside and unchanged from Bubble is from SPEC, not tested.

### T3. The session token route does not validate the channel name it reads. LOW on its own
- `src/app/api/agora/token/route.ts` (session branch) mints for whatever `bookings.agora_channel` holds. The broadcast branch refuses any channel that is not `broadcast_{id}` (`lib/broadcasts/access.ts`). With `bookings` writable over REST (pass 2, A2) this is the step that turns a forged booking into a publisher token on someone else's channel. Closing A2 closes this; a `session_{id}` shape check would be the matching second guard.

### T4. No timeout on PayPal calls. LOW
- `src/lib/paypal/client.ts` sets no `AbortSignal` (Agora uses 45 s, LessonSpace 15 s). A hung PayPal connection holds the capture or order request until the platform kills the function. Nothing is corrupted (no transaction is open, and the webhook settles a capture that PayPal completed), but the buyer sees a spinner and then a generic 500, and may pay again. Both payments would be real and both credited.

## Suspicions, not verified

### T5. Audience tokens may still be able to publish.
- Broadcast viewers get `role: subscriber` (`lib/broadcasts/access.ts`). Agora enforces the publish restriction of a subscriber token only when co-host token authentication is switched on for the project in the Agora console. If it is off, a viewer's token can publish into the broadcast. Console setting, not visible from the repo.

### T6. LessonSpace launch URLs do not expire with the join window.
- `src/lib/lessonspace/client.ts:58-66` sends only `id` and `user { name, leader }`. No `not_before` / `not_after` or session timeout. The join window (10 minutes before to 30 after) is enforced when a URL is issued, not on the URL itself, so a URL issued once may reopen the room later. Whether LessonSpace's default expiry covers this needs their dashboard or docs. No money effect.

### T7. `server-only` is missing on three database modules.
- `src/db/index.ts`, `src/db/queries/join-stamp.ts`, `src/db/queries/shell.ts` (27 of 29 query files have the marker). Nothing imports them from a client file today and `DATABASE_URL` would be undefined in a bundle anyway. Hygiene: the marker is what turns a future mistaken import into a build error.
