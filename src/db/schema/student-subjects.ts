import { index, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./_helpers";
import { profiles, subjects } from "./identity";

// A student's subjects of interest, collected at onboarding (SPEC §7.1/§4.1).
// Mirrors tutor_subjects but with NO level column (levels are a tutor concept).
// The interest references subjects.id by FK — not a slug array — so an admin
// subject rename can never silently orphan a stored interest (see DECISIONS).
// RLS (drizzle/0009): the owning student reads and writes ONLY their own rows;
// no public read.
export const studentSubjects = pgTable(
  "student_subjects",
  {
    studentId: uuid("student_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.studentId, t.subjectId] }),
    index("student_subjects_student_idx").on(t.studentId),
  ],
);
