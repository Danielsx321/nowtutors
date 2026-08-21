import { notFound } from "next/navigation";
import Link from "next/link";
import { GraduationCap, Globe, Languages as LanguagesIcon, CalendarClock } from "lucide-react";
import { getTutorBySlug, getTutorSubjects } from "@/db/queries/tutor-profile";
import { getViewer } from "@/lib/auth/guards";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { PriceTag } from "@/components/ui/price-tag";
import { LivePill } from "@/components/ui/live-pill";
import { SubjectChip } from "@/components/ui/subject-chip";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { FavouriteHeart, type FavouriteMode } from "@/components/features/favourite-heart";

export const dynamic = "force-dynamic"; // viewer-dependent + live-derived

const LEVEL_LABEL: Record<string, string> = {
  all: "All levels",
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tutor = await getTutorBySlug(slug, { viewerId: null });
  if (!tutor) return { title: "Tutor not found · NowTutors" };
  return {
    title: `${tutor.displayName ?? "Tutor"} · NowTutors`,
    description: tutor.headline ?? undefined,
  };
}

/**
 * Public tutor profile (SPEC §6, §7.2). Only APPROVED, non-suspended tutors are
 * reachable — anything else 404s (the query returns null and we notFound()), so
 * a pending/rejected/suspended tutor is indistinguishable from one that never
 * existed. No redirect, no empty page.
 *
 * NO ratings or reviews anywhere — dropped for v1 (§18).
 *
 * Live treatment derives from live_tutors membership (§3.1), never from
 * is_live: the query LEFT JOINs the view and hands us liveStatus, exactly as
 * TutorCard does. "Request now" therefore appears only when the tutor is
 * actually in the view AND accepts_instant.
 */
export default async function TutorProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const viewer = await getViewer();
  const tutor = await getTutorBySlug(slug, { viewerId: viewer?.userId ?? null });
  if (!tutor) notFound();

  const subjects = await getTutorSubjects(tutor.userId);

  const favouriteMode: FavouriteMode = !viewer
    ? "anon"
    : viewer.role === "student"
      ? "student"
      : "hidden";

  const isLiveNow = tutor.liveStatus !== "offline";
  const canRequestNow = isLiveNow && tutor.acceptsInstant;

  return (
    <div className="container-page py-8">
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card surface="ink" className="relative overflow-hidden">
            <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start">
              <Avatar src={tutor.avatarUrl} name={tutor.displayName ?? "Tutor"} size="xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-h2 font-bold text-white">
                    {tutor.displayName ?? "Tutor"}
                  </h1>
                  {tutor.liveStatus === "live" && <LivePill surface="ink" />}
                  {tutor.liveStatus === "online" && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-800 px-2.5 py-0.5 text-caption font-medium text-white">
                      <span className="size-2 rounded-full bg-live-500" aria-hidden />
                      Now Online
                    </span>
                  )}
                </div>
                {tutor.headline && (
                  <p className="text-body-lg text-white">{tutor.headline}</p>
                )}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-ink-300">
                  {tutor.country && (
                    <span className="inline-flex items-center gap-1.5">
                      <Globe className="size-4" aria-hidden />
                      {tutor.country}
                    </span>
                  )}
                  {tutor.languages.length > 0 && (
                    <span className="inline-flex items-center gap-1.5">
                      <LanguagesIcon className="size-4" aria-hidden />
                      {tutor.languages.join(", ")}
                    </span>
                  )}
                  {tutor.completedSessions > 0 && (
                    <span>{tutor.completedSessions} sessions taught</span>
                  )}
                </div>
              </div>
              <FavouriteHeart
                className="absolute right-4 top-4"
                tutorId={tutor.userId}
                initialFavourited={tutor.isFavourited}
                mode={favouriteMode}
              />
            </CardContent>
          </Card>

          {tutor.about && (
            <section className="space-y-2">
              <h2 className="text-h3 font-bold text-gray-700">About</h2>
              <p className="whitespace-pre-line text-body text-gray-700">
                {tutor.about}
              </p>
            </section>
          )}

          {subjects.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-h3 font-bold text-gray-700">Subjects</h2>
              <div className="flex flex-wrap gap-2">
                {subjects.map((s) => (
                  <SubjectChip key={s.slug}>
                    {s.name}
                    {s.level && (
                      <span className="text-gray-500">
                        · {LEVEL_LABEL[s.level] ?? s.level}
                      </span>
                    )}
                  </SubjectChip>
                ))}
              </div>
            </section>
          )}

          {(tutor.education || tutor.yearsExperience != null) && (
            <section className="space-y-2">
              <h2 className="text-h3 font-bold text-gray-700">Background</h2>
              <ul className="space-y-1 text-body text-gray-700">
                {tutor.education && (
                  <li className="flex items-center gap-2">
                    <GraduationCap className="size-4 text-gray-500" aria-hidden />
                    {tutor.education}
                  </li>
                )}
                {tutor.yearsExperience != null && (
                  <li className="flex items-center gap-2">
                    <CalendarClock className="size-4 text-gray-500" aria-hidden />
                    {tutor.yearsExperience} years of experience
                  </li>
                )}
              </ul>
            </section>
          )}

          {tutor.introVideoUrl && (
            <section className="space-y-2">
              <h2 className="text-h3 font-bold text-gray-700">Intro video</h2>
              <Link
                href={tutor.introVideoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="focus-ring rounded-sm text-body text-purple-500 hover:underline"
              >
                Watch {tutor.displayName ?? "this tutor"}&apos;s introduction
              </Link>
            </section>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card surface="ink">
            <CardContent className="space-y-4 p-6">
              <PriceTag
                credits={tutor.hourlyRateCredits}
                unit="hr"
                size="lg"
                surface="ink"
              />
              {canRequestNow && (
                <Button className="w-full" disabled>
                  Request now
                </Button>
              )}
              {/* Availability calendar + "Book a session" are Phase 4 (§7.3).
                  A visible placeholder is used rather than a dead button so the
                  page reads as complete without implying a working flow. */}
              <Alert variant="info">
                Booking opens soon — the availability calendar and “Book a
                session” arrive with scheduled bookings.
              </Alert>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
