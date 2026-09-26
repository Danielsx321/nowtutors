-- Code review 2026-09-20 (docs/review/2026-09-20-pass-1-money.md, M12; the
-- launch-fixes PR, 2026-09-26).
--
-- HAND-WRITTEN, in the shape drizzle-kit would generate for the column in
-- src/db/schema/money.ts.
--
-- WHY. `markEarningsWithdrawn` decided which `tutor_earnings` rows a payout
-- covered by comparing two transaction-start timestamps: the release credit's
-- `created_at` against the request's `created_at`. A release that committed
-- between a request's start and its wallet lock was swept into the request's
-- amount, yet its timestamp was later than the request's, so the row stayed
-- `available` after the money that paid it had gone out. Now the request
-- claims the rows it swept, by id, under the wallet lock it already holds,
-- and marking the request paid flips exactly those rows. A rejected request
-- releases its claim. ON DELETE SET NULL: a request row that is removed (test
-- teardown, or an admin clean-up) must not leave the earnings row pointing at
-- nothing or block its own removal.
ALTER TABLE "tutor_earnings" ADD COLUMN "withdrawal_request_id" uuid;
--> statement-breakpoint
ALTER TABLE "tutor_earnings" ADD CONSTRAINT "tutor_earnings_withdrawal_request_id_withdrawal_requests_id_fk"
  FOREIGN KEY ("withdrawal_request_id") REFERENCES "public"."withdrawal_requests"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "tutor_earnings_withdrawal_request_idx" ON "tutor_earnings" USING btree ("withdrawal_request_id");
