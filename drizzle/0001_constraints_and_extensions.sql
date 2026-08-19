-- Custom migration: extensions, the deferred bookings.payment_id FK (kept out of
-- the Drizzle schema to avoid a bookings<->payments module import cycle), the
-- scheduled-only booking overlap exclusion (Decision #6), and the
-- one-thread-per-pair unique index on conversations (SPEC §4.5).

CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_payment_id_payments_id_fk"
  FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist (
    "tutor_id" WITH =,
    tstzrange("scheduled_start_at", "scheduled_end_at") WITH &&
  )
  WHERE (
    "type" = 'scheduled'
    AND "status" IN ('confirmed', 'in_progress')
    AND "scheduled_start_at" IS NOT NULL
    AND "scheduled_end_at" IS NOT NULL
  );
--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_pair_unique" ON "conversations" USING btree (
  least("participant_a", "participant_b"),
  greatest("participant_a", "participant_b")
);
