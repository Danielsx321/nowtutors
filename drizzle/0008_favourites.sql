CREATE TABLE "favourites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"tutor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favourites_student_tutor_uniq" UNIQUE("student_id","tutor_id")
);
--> statement-breakpoint
ALTER TABLE "favourites" ADD CONSTRAINT "favourites_student_id_profiles_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favourites" ADD CONSTRAINT "favourites_tutor_id_profiles_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "favourites_student_idx" ON "favourites" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "favourites_tutor_idx" ON "favourites" USING btree ("tutor_id");--> statement-breakpoint

-- RLS (SPEC §5 style, matching drizzle/0005). favourites was created after the
-- blanket GRANTs in 0005, so grant its privileges explicitly, then scope every
-- row to the owning student. A student reads and writes ONLY their own rows.
GRANT SELECT, INSERT, DELETE ON public.favourites TO authenticated;--> statement-breakpoint
GRANT ALL ON public.favourites TO service_role;--> statement-breakpoint
ALTER TABLE public.favourites ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "favourites_select" ON public.favourites FOR SELECT TO authenticated
  USING (student_id = auth.uid());--> statement-breakpoint
CREATE POLICY "favourites_insert" ON public.favourites FOR INSERT TO authenticated
  WITH CHECK (student_id = auth.uid());--> statement-breakpoint
CREATE POLICY "favourites_delete" ON public.favourites FOR DELETE TO authenticated
  USING (student_id = auth.uid());