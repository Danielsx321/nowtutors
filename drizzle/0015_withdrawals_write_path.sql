-- Phase 8 Part 2 — withdrawals write path (SPEC §4.4, §5, §7.11; DECISIONS,
-- "Phase 8 Part 2").
--
-- PARTLY HAND-WRITTEN. `drizzle-kit generate` produced the partial unique index
-- below from src/db/schema/money.ts. The policy and privilege changes after it
-- are hand-written: drizzle-kit does not manage this project's RLS (0005, 0012).
--
-- WHY. drizzle/0005 let a tutor INSERT into withdrawal_requests through
-- PostgREST (`WITH CHECK (tutor_id = auth.uid())`) with any amount_credits and
-- no `withdrawal_hold` debit, and let an admin session UPDATE status with no
-- ledger entry. A request row without its hold is a payout of credits nobody
-- set aside, and an admin working the queue could not tell it from a real one.
-- The request row and its hold must commit in ONE transaction, which only a
-- server action on the trusted connection can guarantee. So every client write
-- is removed; reads are unchanged (owning tutor, or admin).
--
-- Authorization for the trusted path is SPEC §5 Layer 2: requestWithdrawal
-- calls requireRole('tutor'), the admin transitions call requireRole('admin'),
-- and every transition writes audit_log.

-- At most one open (requested/approved) request per tutor. Belt and braces
-- with the wallet row lock the request takes: it keeps the admin queue to one
-- row per tutor even if a future write path forgets the lock.
CREATE UNIQUE INDEX "withdrawal_requests_one_open_per_tutor" ON "withdrawal_requests" USING btree ("tutor_id") WHERE "withdrawal_requests"."status" in ('requested', 'approved');
--> statement-breakpoint

DROP POLICY IF EXISTS "withdrawals_insert" ON public.withdrawal_requests;
--> statement-breakpoint
DROP POLICY IF EXISTS "withdrawals_admin_update" ON public.withdrawal_requests;
--> statement-breakpoint

-- Policies alone would already deny these (RLS is enabled and no write policy
-- remains), but the privileges go too, so re-adding a permissive policy later
-- is not enough to reopen the hole by accident.
REVOKE INSERT, UPDATE, DELETE ON public.withdrawal_requests FROM anon, authenticated;
