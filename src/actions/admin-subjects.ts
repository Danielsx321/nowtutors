"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireRole } from "@/lib/auth/guards";
import {
  applyCreateSubject,
  applyRenameSubject,
  applySetSubjectActive,
} from "@/db/queries/admin-subjects";
import {
  createSubjectSchema,
  renameSubjectSchema,
  setSubjectActiveSchema,
} from "@/lib/admin/subjects";

/**
 * `/admin/subjects` actions (SPEC §4.1, §6; Phase 8 Part 5). `requireRole('admin')`
 * first, actor from the guard, audit row in the same transaction as the change.
 */

export type AdminSubjectActionResult = { ok: true; message: string } | { error: string };

function revalidateSubjects() {
  revalidatePath("/admin/subjects");
  revalidatePath("/admin/audit");
  // Subject pickers and chips: browse, tutor profiles, onboarding, profile editor.
  revalidatePath("/", "layout");
}

export async function createSubject(input: { name: string }): Promise<AdminSubjectActionResult> {
  const { user } = await requireRole("admin");
  const parsed = createSubjectSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid subject." };

  const res = await db.transaction((tx) =>
    applyCreateSubject(tx, { name: parsed.data.name, actorId: user.id }),
  );
  if (!res.ok) {
    return {
      error:
        res.reason === "name_taken"
          ? "A subject with that name already exists."
          : `Another subject already uses the link "${res.slug}". Pick a different name.`,
    };
  }

  revalidateSubjects();
  return { ok: true, message: `Added "${parsed.data.name}".` };
}

export async function renameSubject(input: {
  subjectId: string;
  name: string;
}): Promise<AdminSubjectActionResult> {
  const { user } = await requireRole("admin");
  const parsed = renameSubjectSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid subject." };

  const res = await db.transaction((tx) =>
    applyRenameSubject(tx, { ...parsed.data, actorId: user.id }),
  );
  if (!res.ok) {
    return {
      error:
        res.reason === "name_taken"
          ? "A subject with that name already exists."
          : "Subject not found.",
    };
  }

  revalidateSubjects();
  return { ok: true, message: res.changed ? "Renamed." : "No change." };
}

export async function setSubjectActive(input: {
  subjectId: string;
  active: boolean;
}): Promise<AdminSubjectActionResult> {
  const { user } = await requireRole("admin");
  const parsed = setSubjectActiveSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid subject." };

  const res = await db.transaction((tx) =>
    applySetSubjectActive(tx, { ...parsed.data, actorId: user.id }),
  );
  if (!res.ok) return { error: "Subject not found." };

  revalidateSubjects();
  if (!res.changed) return { ok: true, message: "No change." };
  return { ok: true, message: parsed.data.active ? "Subject is active again." : "Subject hidden from pickers." };
}
