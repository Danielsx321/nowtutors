import { z } from "zod";

/**
 * Pure rules for `/admin/subjects` (SPEC §4.1, §6; Phase 8 Part 5).
 *
 * The slug is fixed when a subject is created. It is what browse filters and
 * onboarding/profile forms send, so renaming changes the label people see and
 * never the slug. There is no delete: bookings, session requests and broadcasts
 * reference `subjects.id` with no cascade, and `tutor_subjects` /
 * `student_subjects` cascade, so a delete would either fail or silently strip
 * subjects from tutor profiles and student interests. Deactivating hides a
 * subject from every picker instead.
 */

export const SUBJECT_NAME_MAX = 80;

/** Same rules as the seed's slugify, so admin-created subjects match seeded ones. */
export function subjectSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\+/g, "plus")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const name = z
  .string()
  .trim()
  .min(2, "Subject names need at least 2 characters.")
  .max(SUBJECT_NAME_MAX, `Keep subject names under ${SUBJECT_NAME_MAX} characters.`)
  .refine((n) => subjectSlug(n).length > 0, "Use at least one letter or number.");

export const createSubjectSchema = z.object({ name });
export const renameSubjectSchema = z.object({ subjectId: z.string().uuid(), name });
export const setSubjectActiveSchema = z.object({
  subjectId: z.string().uuid(),
  active: z.boolean(),
});
