-- Weekly availability bonus (availability-bonus, 2026-10-14; SPEC §4.4, §4.7,
-- §7.5, §7.11, §12).
--
-- HAND-WRITTEN, in the shape drizzle-kit would generate for the tables in
-- src/db/schema/availability-bonus.ts and the enum value in enums.ts.
--
-- WHY. Noora's tutor ad promises $40 a week to a tutor who is online 5 hours
-- in the week, and nothing on the site could measure or pay that. The
-- heartbeat only overwrote last_seen_at, so there was no presence history at
-- all. Two tables fix that:
--
-- tutor_online_time: seconds a tutor was LIVE per UTC day, added on every
--   heartbeat by the trusted server (db/queries/presence.ts), capped per beat
--   at the presence staleness window so a gap longer than two minutes (tab
--   hidden, laptop shut) is never counted.
-- availability_bonus_awards: one row per tutor per paid week. The award id is
--   the ledger reference, so between this table's unique week and the ledger's
--   unique (type, reference_id) a week can never be paid twice.
--
-- availability_bonus: the ledger type for the credit. admin_adjustment stays
--   for manual fixes (DECISIONS, "New ledger types instead of admin_adjustment").
--
-- ADD VALUE only for the enum; nothing in this migration uses the new value,
-- so running it inside the migrator's transaction is safe.
ALTER TYPE "public"."credit_transaction_type" ADD VALUE 'availability_bonus';--> statement-breakpoint

CREATE TABLE "tutor_online_time" (
	"tutor_id" uuid NOT NULL,
	"day" date NOT NULL,
	"seconds" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tutor_online_time_tutor_id_day_pk" PRIMARY KEY("tutor_id","day"),
	CONSTRAINT "tutor_online_time_seconds_chk" CHECK ("tutor_online_time"."seconds" >= 0)
);
--> statement-breakpoint
ALTER TABLE "tutor_online_time" ADD CONSTRAINT "tutor_online_time_tutor_id_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tutor_online_time_day_idx" ON "tutor_online_time" USING btree ("day");--> statement-breakpoint

CREATE TABLE "availability_bonus_awards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tutor_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"live_seconds" integer NOT NULL,
	"credits" integer NOT NULL,
	"transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_bonus_awards_credits_chk" CHECK ("availability_bonus_awards"."credits" > 0)
);
--> statement-breakpoint
ALTER TABLE "availability_bonus_awards" ADD CONSTRAINT "availability_bonus_awards_tutor_id_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_bonus_awards" ADD CONSTRAINT "availability_bonus_awards_transaction_id_credit_transactions_id" FOREIGN KEY ("transaction_id") REFERENCES "public"."credit_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "availability_bonus_awards_week_unique" ON "availability_bonus_awards" USING btree ("tutor_id","week_start");--> statement-breakpoint
CREATE INDEX "availability_bonus_awards_week_idx" ON "availability_bonus_awards" USING btree ("week_start" DESC NULLS LAST);--> statement-breakpoint

-- RLS (SPEC §5 style, matching drizzle/0005 and 0008). Both tables were created
-- after the blanket GRANTs in 0005, so privileges are explicit. The owner and
-- admins read; nobody but the service role writes (the heartbeat and the
-- Monday job both run as the trusted server).
GRANT SELECT ON public.tutor_online_time TO authenticated;--> statement-breakpoint
GRANT ALL ON public.tutor_online_time TO service_role;--> statement-breakpoint
ALTER TABLE public.tutor_online_time ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tutor_online_time_select" ON public.tutor_online_time FOR SELECT TO authenticated
  USING (tutor_id = auth.uid() OR public.is_admin());--> statement-breakpoint

GRANT SELECT ON public.availability_bonus_awards TO authenticated;--> statement-breakpoint
GRANT ALL ON public.availability_bonus_awards TO service_role;--> statement-breakpoint
ALTER TABLE public.availability_bonus_awards ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "availability_bonus_awards_select" ON public.availability_bonus_awards FOR SELECT TO authenticated
  USING (tutor_id = auth.uid() OR public.is_admin());--> statement-breakpoint

-- updated_at upkeep, as drizzle/0003 attaches to every table with the column.
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.tutor_online_time
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
