-- Monthly availability bonus (monthly-availability-bonus, 2026-11-15; SPEC §4.4,
-- §4.7, §7.5, §7.11, §12).
--
-- HAND-WRITTEN, in the shape drizzle-kit would generate for the table in
-- src/db/schema/availability-bonus.ts (as 0026 was).
--
-- WHY. Noora changed the tutor promise on 15 Nov 2026: 20 live hours in a
-- calendar month earns $100 (100 credits), paid on the 1st after the month
-- ends, so the bonus can only be withdrawn after month end. The weekly rule
-- (5 hours a week, 40 credits, Mondays) is gone; availability_bonus_awards
-- stays as paid history and is read once, to take weekly credits already paid
-- for weeks starting in November 2026 off the first monthly award.
--
-- availability_bonus_monthly_awards: one row per tutor per paid month. The
--   award id is the ledger reference, so between this table's unique month and
--   the ledger's unique (type, reference_id) a month can never be paid twice.
--   credits is the net paid and may be 0 (weekly credits covered it); the row
--   still marks the month settled so later runs skip it.
CREATE TABLE "availability_bonus_monthly_awards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tutor_id" uuid NOT NULL,
	"month_start" date NOT NULL,
	"live_seconds" integer NOT NULL,
	"credits" integer NOT NULL,
	"weekly_credits_deducted" integer DEFAULT 0 NOT NULL,
	"transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_bonus_monthly_awards_credits_chk" CHECK ("availability_bonus_monthly_awards"."credits" >= 0),
	CONSTRAINT "availability_bonus_monthly_awards_deducted_chk" CHECK ("availability_bonus_monthly_awards"."weekly_credits_deducted" >= 0),
	CONSTRAINT "availability_bonus_monthly_awards_month_chk" CHECK (extract(day from "availability_bonus_monthly_awards"."month_start") = 1)
);
--> statement-breakpoint
ALTER TABLE "availability_bonus_monthly_awards" ADD CONSTRAINT "availability_bonus_monthly_awards_tutor_id_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_bonus_monthly_awards" ADD CONSTRAINT "availability_bonus_monthly_awards_transaction_id_credit_transactions_id" FOREIGN KEY ("transaction_id") REFERENCES "public"."credit_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "availability_bonus_monthly_awards_month_unique" ON "availability_bonus_monthly_awards" USING btree ("tutor_id","month_start");--> statement-breakpoint
CREATE INDEX "availability_bonus_monthly_awards_month_idx" ON "availability_bonus_monthly_awards" USING btree ("month_start" DESC NULLS LAST);--> statement-breakpoint

-- RLS, as 0026: the owner and admins read; only the service role writes (the
-- job runs as the trusted server). Created after 0005's blanket GRANTs, so
-- privileges are explicit and anon has none.
GRANT SELECT ON public.availability_bonus_monthly_awards TO authenticated;--> statement-breakpoint
GRANT ALL ON public.availability_bonus_monthly_awards TO service_role;--> statement-breakpoint
ALTER TABLE public.availability_bonus_monthly_awards ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "availability_bonus_monthly_awards_select" ON public.availability_bonus_monthly_awards FOR SELECT TO authenticated
  USING (tutor_id = auth.uid() OR public.is_admin());
