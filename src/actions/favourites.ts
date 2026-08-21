"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { favourites } from "@/db/schema/favourites";

const schema = z.object({ tutorId: z.string().uuid() });

/**
 * Toggle a favourite for the current student. Guarded server-side — only an
 * authenticated student may favourite. Writes go through the student's own
 * Supabase client so RLS (drizzle/0008) scopes the row to student_id = auth.uid().
 */
export async function toggleFavourite(input: { tutorId: string }): Promise<{ favourited: boolean }> {
  const { profile } = await requireRole("student");
  const { tutorId } = schema.parse(input);

  const [existing] = await db
    .select({ id: favourites.id })
    .from(favourites)
    .where(and(eq(favourites.studentId, profile.id), eq(favourites.tutorId, tutorId)))
    .limit(1);

  const supabase = await createClient();
  if (existing) {
    await supabase.from("favourites").delete().eq("id", existing.id);
  } else {
    await supabase.from("favourites").insert({ tutor_id: tutorId, student_id: profile.id });
  }

  revalidatePath("/");
  revalidatePath("/dashboard/favourites");
  return { favourited: !existing };
}
