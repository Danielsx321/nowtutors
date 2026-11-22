-- Reviews v1 (reviews-v1, 2026-11-22; SPEC §4.3, §7.2, §18; DECISIONS
-- 2026-11-22 "Reviews v1").
--
-- HAND-WRITTEN, in the shape drizzle-kit would generate for the table in
-- src/db/schema/booking.ts, plus the guard and rating triggers drizzle-kit
-- does not manage (as 0026 and 0030 were).
--
-- WHY. The outside reviewer's audit (18 Nov 2026, point 7) asked for reviews
-- on every profile, and Daniels approved bringing them into v1 on
-- 2026-11-22. SPEC had them dropped for v1 (§18 item 2) and gave the future
-- shape in §4.3; this is that shape. First-party only: a student reviews a
-- lesson they actually had. Nothing is imported and nothing is invented
-- (SPEC "Banned tells").
--
-- reviews: one row per completed booking (booking_id unique), written by the
--   booking's student, 1 to 5 stars and an optional comment. is_published is
--   true on write; an admin can hide a review (false), which takes it out of
--   the public list and out of the tutor's average.
--
-- WRITERS. Only the server: actions/reviews.ts on the Drizzle connection
-- (trusted, session_user postgres) and the admin hide action. No client
-- INSERT, UPDATE or DELETE policy exists, so the browser key can only read.
--
-- GUARD (reviews_guard, BEFORE INSERT). Whoever writes, the row must match a
-- completed booking: same student, same tutor, status 'completed'. A bug in
-- the action can't attach a review to someone else's lesson or to a lesson
-- that never happened.
--
-- RATING (reviews_recompute_rating, AFTER INSERT/UPDATE/DELETE). Recomputes
-- tutor_profiles.rating_avg and rating_count from the published rows, so the
-- scalar columns browse already sorts and filters on (0000, §7.2) stay true
-- whatever path changed a review. The write runs in the caller's session, the
-- trusted server or an admin, both of which tutor_stats_guard (0027) admits.
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"tutor_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"comment" text,
	"is_published" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_rating_chk" CHECK ("reviews"."rating" BETWEEN 1 AND 5),
	CONSTRAINT "reviews_comment_len_chk" CHECK ("reviews"."comment" IS NULL OR length("reviews"."comment") <= 1000)
);
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_student_id_profiles_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_tutor_id_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_booking_unique" ON "reviews" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "reviews_tutor_published_idx" ON "reviews" USING btree ("tutor_id","created_at" DESC NULLS LAST) WHERE "reviews"."is_published";--> statement-breakpoint

GRANT SELECT ON public.reviews TO anon, authenticated;--> statement-breakpoint
GRANT ALL ON public.reviews TO service_role;--> statement-breakpoint
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "reviews_select" ON public.reviews FOR SELECT TO anon, authenticated
  USING (is_published OR student_id = auth.uid() OR tutor_id = auth.uid() OR public.is_admin());--> statement-breakpoint

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.reviews_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.id = new.booking_id
      AND b.student_id = new.student_id
      AND b.tutor_id = new.tutor_id
      AND b.status = 'completed'
  ) THEN
    RAISE EXCEPTION 'a review needs a completed booking of this student with this tutor';
  END IF;
  RETURN new;
END;
$$;--> statement-breakpoint

CREATE TRIGGER reviews_guard BEFORE INSERT ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.reviews_guard();--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.reviews_recompute_rating() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  t uuid := coalesce(new.tutor_id, old.tutor_id);
BEGIN
  UPDATE public.tutor_profiles tp
     SET rating_avg = coalesce(s.avg_rating, 0),
         rating_count = s.n
    FROM (
      SELECT round(avg(r.rating)::numeric, 2) AS avg_rating, count(*)::int AS n
        FROM public.reviews r
       WHERE r.tutor_id = t AND r.is_published
    ) s
   WHERE tp.user_id = t;
  RETURN NULL;
END;
$$;--> statement-breakpoint

CREATE TRIGGER reviews_recompute_rating AFTER INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.reviews_recompute_rating();
