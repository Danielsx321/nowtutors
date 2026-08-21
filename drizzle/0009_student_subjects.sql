CREATE TABLE "student_subjects" (
	"student_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_subjects_student_id_subject_id_pk" PRIMARY KEY("student_id","subject_id")
);
--> statement-breakpoint
ALTER TABLE "student_subjects" ADD CONSTRAINT "student_subjects_student_id_profiles_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_subjects" ADD CONSTRAINT "student_subjects_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "student_subjects_student_idx" ON "student_subjects" USING btree ("student_id");--> statement-breakpoint

-- RLS (SPEC §5 style, matching drizzle/0005 and 0008). student_subjects was
-- created after the blanket GRANTs in 0005, so grant its privileges explicitly,
-- then scope every row to the owning student. A student reads and writes ONLY
-- their own interests; there is NO public read (unlike tutor_subjects).
GRANT SELECT, INSERT, DELETE ON public.student_subjects TO authenticated;--> statement-breakpoint
GRANT ALL ON public.student_subjects TO service_role;--> statement-breakpoint
ALTER TABLE public.student_subjects ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "student_subjects_select" ON public.student_subjects FOR SELECT TO authenticated
  USING (student_id = auth.uid());--> statement-breakpoint
CREATE POLICY "student_subjects_insert" ON public.student_subjects FOR INSERT TO authenticated
  WITH CHECK (student_id = auth.uid());--> statement-breakpoint
CREATE POLICY "student_subjects_delete" ON public.student_subjects FOR DELETE TO authenticated
  USING (student_id = auth.uid());
