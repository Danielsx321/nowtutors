import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles, tutorProfiles } from "@/db/schema";
import { favourites } from "@/db/schema/favourites";
import { publicProfiles, liveTutors } from "@/db/schema/views";
import { cardColumns, toTutorCard, type TutorCardData } from "@/db/queries/tutors";

/**
 * A student's favourited tutors, newest first, as TutorCards (SPEC §6
 * /dashboard/favourites). Same visibility rules as browse — approved and
 * non-suspended only, so a favourited tutor who is later suspended simply stops
 * appearing. Live status derives from live_tutors, never is_live (§3.1).
 */
export async function getFavouriteTutors(
  studentId: string,
): Promise<TutorCardData[]> {
  const rows = await db
    .select({
      ...cardColumns,
      favouritedAt: favourites.createdAt,
    })
    .from(favourites)
    .innerJoin(tutorProfiles, eq(tutorProfiles.userId, favourites.tutorId))
    .innerJoin(publicProfiles, eq(publicProfiles.id, tutorProfiles.userId))
    .innerJoin(profiles, eq(profiles.id, tutorProfiles.userId))
    .leftJoin(liveTutors, eq(liveTutors.userId, tutorProfiles.userId))
    .where(
      and(
        eq(favourites.studentId, studentId),
        eq(tutorProfiles.approvalStatus, "approved"),
        eq(profiles.isSuspended, false),
      ),
    )
    .orderBy(desc(favourites.createdAt));

  // isFavourited is true by construction: this is the favourites list.
  return rows.map((r) => toTutorCard(r, true));
}
