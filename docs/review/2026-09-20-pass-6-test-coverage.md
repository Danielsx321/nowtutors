# Pass 6: Test coverage against risk

Reviewed 2026-09-20 against `main` at 9775408. Read-only. 57 unit, 22 DOM, 16 integration and 5 E2E files, plus `src/db/verify-rls.ts`. Coverage was not counted. For each risk from passes 1 to 3, I looked for a test that would fail if the path broke.

What is well covered: ledger invariants (in-memory executor), settlement including the client and webhook race and the retained-credits shape, withdrawal transitions with real Postgres concurrency, release-earnings exactly-once, session end concurrency, the completion sweep's classifications, admin force-cancel and force-complete, and the database client under a burst. The gaps below are paths no test walks, ranked by what breaking them costs.

## 1. Direct REST writes to `bookings` and `session_requests`. No test. (A2, A3)
- `verify-rls.ts` has one bookings assertion, a read (line 110). Nothing attempts an INSERT or UPDATE on `bookings` or `session_requests` as a signed-in user. `grep 'from("bookings")' ` for insert or update across `tests/` and `verify-rls.ts` returns nothing.
- Cost if open: free sessions, skipped PayPal payments, and fabricated earnings that reach a PayPal payout. This is the class the script exists to catch, and it caught the two earlier instances (self-approval, the `is_trusted_server` bug) precisely because someone wrote the assertion.

## 2. Role escalation from a NULL role. No test. (A1)
- `verify-rls.ts:129-141` asserts that an onboarded student cannot set `role = 'admin'`. No test signs up a fresh account (role NULL) and tries the same PATCH. The guard's one permissive branch is the untested one.
- Cost: full admin, including credit adjustments and withdrawal approval.

## 3. Earnings for a session a participant ends. No test. (M1)
- `tests/integration/session-end-concurrency.test.ts` proves the transition happens once; its only mention of earnings is a comment. `tests/integration/complete-sessions.test.ts` has 13 cases, all of which start from rows the sweep itself transitions. No test ends a session through `endSession` or `getSessionState` and then asserts a `tutor_earnings` row exists after the next sweep.
- E2E 4 (`withdrawal-reconcile.spec.ts:75-90`) inserts the completed booking and its held earnings row directly with SQL, so the acceptance path for withdrawals never depends on earnings being created by the app.
- Cost: every tutor unpaid for the most common way an instant session ends. A five-line integration test (end by participant, run sweep, expect one earnings row) fails today.

## 4. A death between the completion sweep and the earnings insert. No test. (M2, R2)
- "cannot double-pay a booking that already has an earnings row" covers the opposite direction. Nothing simulates `insertHeldEarnings` throwing after the sweeps commit and then checks that a second run still pays.
- Cost: silent, permanent non-payment for whatever rows were in flight.

## 5. Two simultaneous instant requests from one student. No test. (R1)
- The only reference to the one-pending rule in any test is a comment in `presence-ungraceful-exit.spec.ts`. No unit or integration test fires two `createSessionRequest` calls together. Withdrawals has the equivalent test (`withdrawals.test.ts`, two requests from one tutor) and an index behind it.
- Cost: a student charged twice with no refund path.

## 6. Late COMPLETED on a refunded payment: the test asserts the defect. (M4)
- `tests/unit/paypal-settlement.test.ts:217-224`, "a refunded payment is not resurrected by a late COMPLETED", checks that the status stays `refunded` and then expects `result.status` to be `"credited"`. The test name says the opposite of what it pins. If this is intended it should say so in SPEC 7.6; if not, the test is protecting the bug.

## 7. Partial refunds. No test. (M5)
- `paypal-webhook.test.ts` covers REFUNDED as a status change. No fixture carries a refund amount smaller than the capture, and `admin-bookings.test.ts` / `admin-control.test.ts` reverse only full refunds.
- Cost: an admin wipes all credits or cancels a booking after a $5 goodwill refund.

## 8. First credit into a wallet that does not exist, concurrently. No test. (M3)
- The in-memory ledger models the row lock, but there is no row to lock in this case, and the integration suite seeds wallets up front (`helpers/test-db.ts`). No test runs two first-credits in parallel against real Postgres.
- Cost: cached balance drift and a wrong `balance_after` in an append-only table, caught a day later by reconcile.

## 9. Direct-pay after a rate change. No test. (M6)
- `paypal-direct-pay.test.ts` asserts the price is re-derived from the current rate. Nothing asserts what `bookings.price_credits`, the `booking_debit` and the later earnings split look like when the two differ.

## 10. Webhook verification with a non-ASCII payload. No test. (M8)
- Every webhook fixture is ASCII and verification is mocked (`verifySignature` is injected). The re-serialisation question can only be answered in the PayPal sandbox.

## 11. Suspended participant calling `endSession` directly. No test. (A5)
- The session action tests run with an active user.

## Not a gap, but worth knowing
- The presence E2E and broadcast E2E depend on a quiet machine and the VPN being off (PROGRESS, 2026-09-20). They are the only tests of Realtime delivery, so on a loaded laptop the suite says nothing about it either way.
