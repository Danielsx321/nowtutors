import { index, pgTable, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, uuidPk } from "./_helpers";
import { profiles } from "./identity";

// A student's favourited tutors. PARITY feature the spec originally missed
// (Bubble's Favourite_Tutors list); added to SPEC §4 in the same commit. RLS
// (drizzle/0008) scopes every row to student_id = auth.uid(). No update path.
export const favourites = pgTable(
  "favourites",
  {
    id: uuidPk(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("favourites_student_tutor_uniq").on(t.studentId, t.tutorId),
    index("favourites_student_idx").on(t.studentId),
    index("favourites_tutor_idx").on(t.tutorId),
  ],
);
