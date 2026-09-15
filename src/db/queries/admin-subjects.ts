import "server-only";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { auditLog, subjects } from "@/db/schema";
import { subjectSlug } from "@/lib/admin/subjects";

/**
 * `/admin/subjects` reads and writes (SPEC §4.1, §6; Phase 8 Part 5). Each
 * `apply*` writes its `audit_log` row in the caller's transaction. No delete
 * exists: see `lib/admin/subjects.ts`.
 */

export interface AdminSubjectRow {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
  tutorCount: number;
  studentCount: number;
  bookingCount: number;
}

export async function listAdminSubjects(): Promise<AdminSubjectRow[]> {
  const rows = await db
    .select({
      id: subjects.id,
      name: subjects.name,
      slug: subjects.slug,
      sortOrder: subjects.sortOrder,
      isActive: subjects.isActive,
      tutorCount: sql<number>`(select count(*) from tutor_subjects ts where ts.subject_id = ${subjects.id})::int`,
      studentCount: sql<number>`(select count(*) from student_subjects ss where ss.subject_id = ${subjects.id})::int`,
      bookingCount: sql<number>`(select count(*) from bookings b where b.subject_id = ${subjects.id})::int`,
    })
    .from(subjects)
    .orderBy(asc(subjects.sortOrder), asc(subjects.name));
  return rows.map((r) => ({
    ...r,
    tutorCount: Number(r.tutorCount),
    studentCount: Number(r.studentCount),
    bookingCount: Number(r.bookingCount),
  }));
}

type Tx = DbTransaction;

async function nameTaken(tx: Tx, name: string, exceptId?: string): Promise<boolean> {
  const where = exceptId
    ? and(sql`lower(${subjects.name}) = lower(${name})`, ne(subjects.id, exceptId))
    : sql`lower(${subjects.name}) = lower(${name})`;
  const [row] = await tx.select({ id: subjects.id }).from(subjects).where(where).limit(1);
  return !!row;
}

export type CreateSubjectResult =
  | { ok: true; id: string; slug: string }
  | { ok: false; reason: "name_taken" | "slug_taken"; slug: string };

/** New subjects go to the end of the list, active. */
export async function applyCreateSubject(
  tx: Tx,
  p: { name: string; actorId: string },
): Promise<CreateSubjectResult> {
  const slug = subjectSlug(p.name);
  if (await nameTaken(tx, p.name)) return { ok: false, reason: "name_taken", slug };

  const [row] = await tx
    .insert(subjects)
    .values({
      name: p.name,
      slug,
      sortOrder: sql`(select coalesce(max(sort_order), 0) + 1 from subjects)`,
      isActive: true,
    })
    .onConflictDoNothing({ target: subjects.slug })
    .returning({ id: subjects.id });
  if (!row) return { ok: false, reason: "slug_taken", slug };

  await tx.insert(auditLog).values({
    actorId: p.actorId,
    action: "subject.create",
    targetType: "subject",
    targetId: row.id,
    payload: { name: p.name, slug },
  });
  return { ok: true, id: row.id, slug };
}

async function lockSubject(tx: Tx, subjectId: string) {
  const [row] = await tx
    .select({ name: subjects.name, slug: subjects.slug, isActive: subjects.isActive })
    .from(subjects)
    .where(eq(subjects.id, subjectId))
    .for("update")
    .limit(1);
  return row ?? null;
}

export type RenameSubjectResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: "not_found" | "name_taken" };

/** Changes the name only; the slug stays what it was created with. */
export async function applyRenameSubject(
  tx: Tx,
  p: { subjectId: string; name: string; actorId: string },
): Promise<RenameSubjectResult> {
  const before = await lockSubject(tx, p.subjectId);
  if (!before) return { ok: false, reason: "not_found" };
  if (before.name === p.name) return { ok: true, changed: false };
  if (await nameTaken(tx, p.name, p.subjectId)) return { ok: false, reason: "name_taken" };

  await tx.update(subjects).set({ name: p.name }).where(eq(subjects.id, p.subjectId));
  await tx.insert(auditLog).values({
    actorId: p.actorId,
    action: "subject.rename",
    targetType: "subject",
    targetId: p.subjectId,
    payload: { slug: before.slug, from: before.name, to: p.name },
  });
  return { ok: true, changed: true };
}

export type SetSubjectActiveResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: "not_found" };

export async function applySetSubjectActive(
  tx: Tx,
  p: { subjectId: string; active: boolean; actorId: string },
): Promise<SetSubjectActiveResult> {
  const before = await lockSubject(tx, p.subjectId);
  if (!before) return { ok: false, reason: "not_found" };
  if (before.isActive === p.active) return { ok: true, changed: false };

  await tx.update(subjects).set({ isActive: p.active }).where(eq(subjects.id, p.subjectId));
  await tx.insert(auditLog).values({
    actorId: p.actorId,
    action: p.active ? "subject.activate" : "subject.deactivate",
    targetType: "subject",
    targetId: p.subjectId,
    payload: { slug: before.slug, name: before.name },
  });
  return { ok: true, changed: true };
}
