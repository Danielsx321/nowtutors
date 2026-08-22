import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { availabilityExceptions, availabilityRules } from "@/db/schema";

export interface AvailabilityRuleRow {
  id: string;
  weekday: number;
  startTime: string; // "HH:MM:SS"
  endTime: string;
  isActive: boolean;
}

export interface AvailabilityExceptionRow {
  id: string;
  date: string; // "YYYY-MM-DD"
  isAvailable: boolean;
  startTime: string | null;
  endTime: string | null;
}

/** The signed-in tutor's own weekly rules + date exceptions, for the editor. */
export async function getOwnAvailability(tutorId: string): Promise<{
  rules: AvailabilityRuleRow[];
  exceptions: AvailabilityExceptionRow[];
}> {
  const [rules, exceptions] = await Promise.all([
    db
      .select({
        id: availabilityRules.id,
        weekday: availabilityRules.weekday,
        startTime: availabilityRules.startTime,
        endTime: availabilityRules.endTime,
        isActive: availabilityRules.isActive,
      })
      .from(availabilityRules)
      .where(eq(availabilityRules.tutorId, tutorId))
      .orderBy(asc(availabilityRules.weekday), asc(availabilityRules.startTime)),
    db
      .select({
        id: availabilityExceptions.id,
        date: availabilityExceptions.date,
        isAvailable: availabilityExceptions.isAvailable,
        startTime: availabilityExceptions.startTime,
        endTime: availabilityExceptions.endTime,
      })
      .from(availabilityExceptions)
      .where(eq(availabilityExceptions.tutorId, tutorId))
      .orderBy(asc(availabilityExceptions.date)),
  ]);
  return { rules, exceptions };
}
