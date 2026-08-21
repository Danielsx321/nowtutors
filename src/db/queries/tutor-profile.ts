import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { profiles, tutorProfiles, tutorSubjects, subjects } from "@/db/schema";
import { favourites } from "@/db/schema/favourites";
import { publicProfiles, liveTutors } from "@/db/schema/views";
import type { LiveStatus } from "@/db/queries/tutors";

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export interface TutorSubjectEntry {
  name: string;
  slug: string;
  level: string | null;
}

export interface TutorProfileData {
  userId: string;
  slug: string;
  displayName: string | null;
  avatarUrl: string | null;
  country: string | null;
  bio: string | null;
  headline: string | null;
  about: string | null;
  introVideoUrl: string | null;
  education: string | null;
  yearsExperience: number | null;
  languages: string[];
  hourlyRateCredits: number;
  completedSessions: number;
  acceptsInstant: boolean;
  liveStatus: LiveStatus;
  isFavourited: boolean;
}

/** Subjects + levels for a tutor, in the canonical subject order. */
export async function getTutorSubjects(
  tutorUserId: string,
): Promise<TutorSubjectEntry[]> {
  const rows = await db
    .select({
      name: subjects.name,
      slug: subjects.slug,
      level: tutorSubjects.level,
    })
    .from(tutorSubjects)
    .innerJoin(subjects, eq(subjects.id, tutorSubjects.subjectId))
    .where(eq(tutorSubjects.tutorId, tutorUserId))
    .orderBy(asc(subjects.sortOrder));
  return rows.map((r) => ({ name: r.name, slug: r.slug, level: r.level }));
}

/**
 * Public tutor profile by slug (SPEC §7.2 / §6). Returns null unless the tutor
 * is APPROVED and their owning profile is not suspended — the page 404s on null,
 * so a pending, rejected or suspended tutor is indistinguishable from a
 * nonexistent one. Live status derives from live_tutors membership, NEVER from
 * tutor_profiles.is_live (SPEC §3.1) — the same rule as TutorCard.
 */
export async function getTutorBySlug(
  slug: string,
  opts: { viewerId: string | null },
): Promise<TutorProfileData | null> {
  const [row] = await db
    .select({
      userId: tutorProfiles.userId,
      slug: tutorProfiles.slug,
      headline: tutorProfiles.headline,
      about: tutorProfiles.about,
      introVideoUrl: tutorProfiles.introVideoUrl,
      education: tutorProfiles.education,
      yearsExperience: tutorProfiles.yearsExperience,
      languages: tutorProfiles.languages,
      hourlyRateCredits: tutorProfiles.hourlyRateCredits,
      completedSessions: tutorProfiles.completedSessions,
      acceptsInstant: tutorProfiles.acceptsInstant,
      displayName: publicProfiles.displayName,
      avatarUrl: publicProfiles.avatarUrl,
      country: publicProfiles.country,
      bio: publicProfiles.bio,
      liveMemberUserId: liveTutors.userId,
      liveMode: liveTutors.liveMode,
      isFavourited: sql<boolean>`${favourites.id} is not null`,
    })
    .from(tutorProfiles)
    .innerJoin(publicProfiles, eq(publicProfiles.id, tutorProfiles.userId))
    .innerJoin(profiles, eq(profiles.id, tutorProfiles.userId))
    .leftJoin(liveTutors, eq(liveTutors.userId, tutorProfiles.userId))
    .leftJoin(
      favourites,
      and(
        eq(favourites.tutorId, tutorProfiles.userId),
        eq(favourites.studentId, opts.viewerId ?? NIL_UUID),
      ),
    )
    .where(
      and(
        eq(tutorProfiles.slug, slug),
        eq(tutorProfiles.approvalStatus, "approved"),
        eq(profiles.isSuspended, false),
      ),
    )
    .limit(1);

  if (!row) return null;

  return {
    userId: row.userId,
    slug: row.slug,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    country: row.country,
    bio: row.bio,
    headline: row.headline,
    about: row.about,
    introVideoUrl: row.introVideoUrl,
    education: row.education,
    yearsExperience: row.yearsExperience,
    languages: row.languages ?? [],
    hourlyRateCredits: row.hourlyRateCredits,
    completedSessions: row.completedSessions,
    acceptsInstant: row.acceptsInstant,
    liveStatus: !row.liveMemberUserId
      ? "offline"
      : row.liveMode === "broadcast"
        ? "live"
        : "online",
    isFavourited: row.isFavourited,
  };
}

/** The signed-in tutor's own editable profile (any approval status). */
export async function getOwnTutorProfile(userId: string) {
  const [row] = await db
    .select()
    .from(tutorProfiles)
    .where(eq(tutorProfiles.userId, userId))
    .limit(1);
  return row ?? null;
}
