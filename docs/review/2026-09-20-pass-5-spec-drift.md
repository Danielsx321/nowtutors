# Pass 5: Spec drift and dead code

Reviewed 2026-09-20 against `main` at 9775408. Read-only. Compared `src/app` pages and `src/lib/routes.ts` with SPEC 6, `src/db/schema/*` tables and enums with SPEC 4, the cron routes with SPEC 12, and SPEC 7 claims against what passes 1 to 4 found in the code. Scanned every `export function|const|class` in `src/` for use in another source file or a test. Checked the DECISIONS entries from 2026-09-19 onward against SPEC.

What held up: the schema has every table SPEC 4 names except `reviews` (deliberately not built). Enums match. All six built cron routes exist and match SPEC 12's table. Phase 10 routes are absent and unlinked as intended. The old design alias block is gone. There is very little dead code for a codebase this size: 9 unused exports out of several hundred.

## Code and SPEC disagree

### D1. SPEC 7.11 says a completed session produces an earnings row. The code does that only when the cron is the one that completes it.
- The money finding is M1 in pass 1. The drift angle: SPEC 7.11 ("Session completes, `tutor_earnings` row, `status = held`") and SPEC 7.4's Part 3B note ("Nothing in this pass ... writes `tutor_earnings`", deferring to Part 3C) were never reconciled. A stale marker records the original intent and that it was dropped: `src/db/queries/session-requests.ts:456`, `// TODO(Phase 6 Part 3C): end-session writes tutor_earnings.` Part 3C shipped as a cron that only covers rows it closes itself.

### D2. SPEC 3.5 says "There is deliberately no `vercel.json`". There is one.
- `vercel.json` sets `regions: ["cdg1"]` (PR #105). SPEC 3.5 and SPEC 12 still describe its absence as deliberate. The reason for the old rule (no Vercel crons) still holds, but the sentence is now false and the region choice is recorded only in the Phase 9.5 status line and PROGRESS. There is no DECISIONS entry for PR #105 at all; the last heading is the two-client entry.

### D3. The two database clients are in DECISIONS three times and in SPEC nowhere.
- DECISIONS lines 5017, 5034 and 5042 settle how the app talks to Postgres (`max_pipeline: 0` for plain queries, a separate client for transactions). `grep -i "max_pipeline\|transactionClient\|two clients" docs/SPEC.md` returns nothing. SPEC 2 (stack) still reads as one client. CLAUDE.md requires the SPEC section to change in the same commit as the DECISIONS entry.

### D4. SPEC 7.4 says the room asks the server at three events. It is four.
- DECISIONS line 5003 (`fix-room-end-for-both`): the room now also calls `getSessionState` when the SDK reports the other person left. SPEC 7.4's Part 3B note still lists mount, the other party arriving, and the countdown reaching zero. Same CLAUDE.md rule.

### D5. SPEC 5 names a guard that does not exist.
- "`requireUser()`, `requireRole('tutor')`, `requireBookingParticipant(bookingId)` helpers live in `lib/auth/guards.ts`". There is no `requireBookingParticipant` anywhere in `src/`. Participation is checked inline in five places (`actions/sessions.ts` twice, `lib/agora/session-access.ts`, `lib/lessonspace/session-access.ts`, `db/queries/sessions.ts`). The checks are correct; the SPEC describes a helper that was never written, and the five copies are the duplication.

### D6. SPEC 5's table says bookings writes are "status transitions restricted (Section 7)" at the RLS layer. They are not.
- The security finding is A2 in pass 2. As drift: the Layer 1 table promises a restriction that no policy, trigger or grant implements. Same for `session_requests` ("student inserts; tutor updates status": the policy lets either participant update anything).

### D7. SPEC 7.6 says the webhook marks a payment refunded "after a full refund". The webhook cannot tell.
- M5 in pass 1. SPEC's wording assumes a distinction the handler does not make.

### D8. `session_requests.status = 'cancelled'` is unreachable, and the UI tells students to use it.
- The enum has `cancelled`, SPEC 7.4 says the waiting modal shows a distinct message for it, and `createSessionRequest` answers a second request with "You already have a request waiting. Cancel it or wait for an answer." (`src/actions/session-requests.ts:166`). No action writes `cancelled`; there is no `cancelSessionRequest`. A student who picked the wrong tutor waits out the TTL.

### D9. SPEC 7.4 asks for a `leaveSession` action on `beforeunload` and disconnect. None exists.
- SPEC lists screen share, chat and credits consumed as not built, but not this one. SPEC says never to depend on it for correctness, and nothing does, so this is a documentation gap only.

### D10. Pages that exist and SPEC 6 does not list.
- `/dashboard/favourites` (in `routes.ts`, table in SPEC 4.8 and 5, missing from the SPEC 6 route list), `/suspended` (the target of every suspension redirect), and `/dev/kitchen-sink`.
- `/dev/kitchen-sink` is a Phase 2 build aid (SPEC 16). `src/app/dev/kitchen-sink/page.tsx` has no environment check and no guard, so it is served publicly in production. Harmless content, but it is a leftover.

## Dead code and leftovers

### D11. `bookings.payment_id` is never written.
- The FK to `payments` exists (`drizzle/0001`), SPEC 4.3 describes it, and `getAdminBookingDetail` reads it, then falls back to `payments.booking_id` because it is always NULL. Settlement never stamps it. One of the two links is dead.

### D12. Unused exports (no other source file, no test, not used in their own file)
- `src/lib/auth/guards.ts` `requireOnboarded`
- `src/db/queries/bookings.ts` `getRecentTutorsForStudent`
- `src/components/layout/nav-config.ts` `publicNav`, `roleHome`
- `src/components/features/wallet/buy-credits.tsx` `BuyCreditsUnavailable`
- `src/lib/design/tokens.ts` `tokenValue`
- `src/components/ui/dropdown-menu.tsx` `DropdownMenuGroup`, `src/components/ui/select.tsx` `SelectGroup` (shadcn primitives, normal to leave)
- `src/db/schema/broadcast.ts` `broadcastViewers` (the table is used through raw SQL only, so the Drizzle object is never referenced)

### D13. Exported and exercised only by tests
- `src/lib/presence/staleness.ts` `isPresenceFresh`: a TypeScript copy of the 2-minute freshness rule that no runtime code calls. The `live_tutors` view is the real rule. The test passes whether or not the view agrees with it.
- `src/lib/tutors/filters.ts` `composeTutorWhere` (the query uses `composeTutorFilters`; the wrapper is test-only).
- `src/lib/routes.ts` `isExistingRoute` (by design: it exists for the header and footer tests).

### D14. Small duplication
- `const UNIQUE_VIOLATION = "23505"` is declared four times (`lib/credits/ledger.ts:178`, `db/queries/messaging.ts:30`, `db/queries/broadcasts.ts:29`, `db/queries/withdrawals.ts:34`) although `ledger.ts` already exports `pgErrorCode`.
