import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { profiles, tutorProfiles } from "@/db/schema";
import { favourites } from "@/db/schema/favourites";
import { publicProfiles, liveTutors } from "@/db/schema/views";
import type { TutorCardData } from "@/db/queries/tutors";

/**
 * A student's favourited tutors, newest first, as TutorCards (SPEC §6
 * /dashboard/favourites). Same visibility rules as browse — approved and
 * non-suspended only, so a favourited tutor who is later suspended simply stops
 * appearing. Live status derives from live_tutors, never is_live (§3.1).
 */
export async function getFavouriteTutors(
  studentId: string,
): Promise<TutorCardData[]> {
  const subjectsAgg = sql<
    string[]
  >`coalesce((select array_agg(s.name order by s.sort_order) from tutor_subjects ts join subjects s on s.id = ts.subject_id where ts.tutor_id = ${tutorProfiles.userId}), '{}')`;

  const rows = await db
    .select({
      userId: tutorProfiles.userId,
      slug: tutorProfiles.slug,
      headline: tutorProfiles.headline,
      hourlyRateCredits: tutorProfiles.hourlyRateCredits,
      ratingAvg: tutorProfiles.ratingAvg,
      ratingCount: tutorProfiles.ratingCount,
      displayName: publicProfiles.displayName,
      avatarUrl: publicProfiles.avatarUrl,
      country: publicProfiles.country,
      liveMemberUserId: liveTutors.userId,
      liveMode: liveTutors.liveMode,
      favouritedAt: favourites.createdAt,
      subjects: subjectsAgg,
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

  return rows.map((r) => ({
    userId: r.userId,
    slug: r.slug,
    displayName: r.displayName,
    avatarUrl: r.avatarUrl,
    country: r.country,
    headline: r.headline,
    ratingAvg: Number(r.ratingAvg),
    ratingCount: r.ratingCount,
    hourlyRateCredits: r.hourlyRateCredits,
    subjects: (r.subjects ?? []).slice(0, 3),
    liveStatus: !r.liveMemberUserId
      ? "offline"
      : r.liveMode === "broadcast"
        ? "live"
        : "online",
    isFavourited: true, // by construction — this is the favourites list
  }));
}
