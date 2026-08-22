"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { availabilityExceptions, availabilityRules } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";

export type SaveAvailabilityResult = { ok: true } | { error: string };

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const ruleSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startTime: time,
    endTime: time,
    isActive: z.boolean().default(true),
  })
  .refine((r) => r.startTime < r.endTime, {
    message: "End time must be after start time.",
    path: ["endTime"],
  });

const exceptionSchema = z
  .object({
    date: ymd,
    isAvailable: z.boolean(),
    startTime: time.nullish(),
    endTime: time.nullish(),
  })
  .superRefine((e, ctx) => {
    if (e.isAvailable) {
      // A custom-hours day needs both bounds, ordered.
      if (!e.startTime || !e.endTime) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Set start and end times for a custom day." });
      } else if (e.startTime >= e.endTime) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "End time must be after start time." });
      }
    }
  });

const schema = z.object({
  rules: z.array(ruleSchema).max(100),
  exceptions: z.array(exceptionSchema).max(365),
});

export type SaveAvailabilityInput = z.infer<typeof schema>;

/**
 * Replace the signed-in tutor's weekly availability rules and date exceptions
 * (SPEC §4.2, §6 /tutor/availability). Guarded — the tutor id comes from the
 * guard, never the client, so there is no other tutor's schedule to target
 * (SPEC §5 Layer 2). Whole-schedule replace inside one transaction: the editor
 * submits the complete desired state, so delete-all-then-insert is simplest and
 * atomic. A full-day block is `is_available=false` with null times; a custom day
 * is `is_available=true` with both times (SPEC §4.2).
 */
export async function saveAvailability(
  input: SaveAvailabilityInput,
): Promise<SaveAvailabilityResult> {
  const { user } = await requireRole("tutor", { requireApproval: false });

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the schedule and try again." };
  }
  const v = parsed.data;

  // Reject duplicate exception dates (one override row per date).
  const dates = new Set<string>();
  for (const e of v.exceptions) {
    if (dates.has(e.date)) return { error: `You have two entries for ${e.date}.` };
    dates.add(e.date);
  }

  await db.transaction(async (tx) => {
    await tx.delete(availabilityRules).where(eq(availabilityRules.tutorId, user.id));
    await tx.delete(availabilityExceptions).where(eq(availabilityExceptions.tutorId, user.id));

    if (v.rules.length) {
      await tx.insert(availabilityRules).values(
        v.rules.map((r) => ({
          tutorId: user.id,
          weekday: r.weekday,
          startTime: r.startTime,
          endTime: r.endTime,
          isActive: r.isActive,
        })),
      );
    }
    if (v.exceptions.length) {
      await tx.insert(availabilityExceptions).values(
        v.exceptions.map((e) => ({
          tutorId: user.id,
          date: e.date,
          isAvailable: e.isAvailable,
          startTime: e.isAvailable ? (e.startTime ?? null) : null,
          endTime: e.isAvailable ? (e.endTime ?? null) : null,
        })),
      );
    }
  });

  revalidatePath("/tutor/availability");
  return { ok: true };
}
