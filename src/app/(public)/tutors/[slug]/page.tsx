import { notFound } from "next/navigation";
import Link from "next/link";
import { GraduationCap, Globe, Languages as LanguagesIcon, PlayCircle, ShieldCheck } from "lucide-react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { getTutorBySlug, getTutorSubjects } from "@/db/queries/tutor-profile";
import {
  getBookableSubjects,
  getPublicBookingCalendar,
  getWalletBalance,
} from "@/db/queries/bookings";
import { getViewer } from "@/lib/auth/guards";
import { getBookingSettings, getInstantRequestTtlSeconds, getUsdPerCredit } from "@/lib/settings";
import { TRUST_GUARANTEE, TRUST_GUARANTEE_CONFIRMED, TRUST_PAYMENT } from "@/lib/copy/trust";
import { BookingWidget, type BookingMode } from "@/components/features/booking/booking-widget";
import { InstantRequestWidget } from "@/components/features/booking/instant-request-widget";
import { LiveChip } from "@/components/ui/live-chip";
import { Money } from "@/components/ui/money";
import { OnAirRing } from "@/components/ui/on-air-ring";
import { StatRow } from "@/components/ui/stat-row";
import { SubjectChip } from "@/components/ui/subject-chip";
import { TutorPhoto } from "@/components/features/tutor-photo";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FavouriteHeart, type FavouriteMode } from "@/components/features/favourite-heart";
import { MessageTutorButton } from "@/components/features/messaging/message-tutor-button";

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
 * NO ratings or reviews anywhere: they come after launch (§18).
 *
 * Layout (design overhaul Part 3, research report 01): photo header, name,
 * live state, proof row, About, subjects, background, then a sticky panel on
 * `lg` (price, Start now when instant-available, Book a session, Message) and
 * a sticky bottom bar on smaller screens that jumps to it. One primary action:
 * when "Start now" is on offer it is the green one and booking steps back.
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

  const isStudentViewer = viewer?.role === "student";
  const [
    subjects,
    calendar,
    bookableSubjects,
    viewerProfile,
    walletBalance,
    bookingSettings,
    instantTtlSeconds,
    usdPerCredit,
  ] = await Promise.all([
    getTutorSubjects(tutor.userId),
    getPublicBookingCalendar(tutor.userId),
    getBookableSubjects(tutor.userId),
    viewer
      ? db
          .select({ timezone: profiles.timezone })
          .from(profiles)
          .where(eq(profiles.id, viewer.userId))
          .limit(1)
      : Promise.resolve([]),
    isStudentViewer ? getWalletBalance(viewer.userId) : Promise.resolve(0),
    getBookingSettings(),
    getInstantRequestTtlSeconds(),
    getUsdPerCredit(),
  ]);

  const bookingMode: BookingMode = !viewer
    ? "anon"
    : viewer.userId === tutor.userId
      ? "self"
      : viewer.role === "student"
        ? "student"
        : "tutor";
  // Render slots in the student's saved timezone, then the tutor's for reference.
  const viewerTimeZone = viewerProfile[0]?.timezone ?? calendar?.tutorTimeZone ?? "UTC";

  const favouriteMode: FavouriteMode = !viewer
    ? "anon"
    : viewer.role === "student"
      ? "student"
      : "hidden";

  // Q5 (Phase 9 Part 3): a tutor who is live-broadcasting ("live") can't be
  // sent an instant request; only "online" (live for instant sessions) can.
  // createSessionRequest refuses it server-side either way.
  const canRequestNow = tutor.liveStatus === "online" && tutor.acceptsInstant;

  const name = tutor.displayName ?? "Tutor";
  const loginHref = `/login?next=/tutors/${slug}`;
  const rate = (size: "sm" | "md" | "lg") => (
    <Money
      credits={tutor.hourlyRateCredits}
      usdPerCredit={usdPerCredit ?? undefined}
      showUsd={usdPerCredit != null}
      per="hr"
      size={size}
    />
  );

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pb-28 pt-8 md:px-6 lg:pb-12">
      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-8">
          <header className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <OnAirRing
              active={canRequestNow}
              className="block shrink-0 self-start rounded-lg ring-offset-2 ring-offset-surface"
            >
              <TutorPhoto
                src={tutor.avatarUrl}
                name={name}
                sizes="160px"
                className="size-32 sm:size-40"
                initialsClassName="text-display"
              />
            </OnAirRing>
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-2">
                  <h1 className="font-display text-h1 font-bold text-text">{name}</h1>
                  {canRequestNow && <LiveChip />}
                  {tutor.liveStatus === "live" && tutor.liveBroadcastId && (
                    <Link
                      href={`/live/${tutor.liveBroadcastId}`}
                      aria-label={`LIVE, watch ${name}'s broadcast`}
                      className="focus-ring inline-flex rounded-full"
                    >
                      <LiveChip label="LIVE" />
                    </Link>
                  )}
                </div>
                <FavouriteHeart
                  tutorId={tutor.userId}
                  initialFavourited={tutor.isFavourited}
                  mode={favouriteMode}
                  loginHref={loginHref}
                  className="border border-border"
                />
              </div>
              {tutor.headline && <p className="text-body-lg text-text">{tutor.headline}</p>}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-text-muted">
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
              </div>
            </div>
          </header>

          <StatRow
            className="max-w-xl"
            stats={[
              {
                label: "Experience",
                value:
                  tutor.yearsExperience && tutor.yearsExperience > 0
                    ? `${tutor.yearsExperience} ${tutor.yearsExperience === 1 ? "year" : "years"}`
                    : "New",
              },
              {
                label: "Sessions",
                value: tutor.completedSessions > 0 ? tutor.completedSessions.toLocaleString() : "New",
              },
              { label: "Rate", value: rate("sm") },
            ]}
          />

          {tutor.about && (
            <section className="space-y-2">
              <h2 className="text-h2 font-semibold text-text">About</h2>
              <p className="max-w-prose whitespace-pre-line text-body text-text">{tutor.about}</p>
            </section>
          )}

          {subjects.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-h2 font-semibold text-text">Subjects</h2>
              <div className="flex flex-wrap gap-2">
                {subjects.map((s) => (
                  <SubjectChip key={s.slug}>
                    {s.name}
                    {s.level && (
                      <span className="text-text-muted">· {LEVEL_LABEL[s.level] ?? s.level}</span>
                    )}
                  </SubjectChip>
                ))}
              </div>
            </section>
          )}

          {(tutor.education || tutor.introVideoUrl) && (
            <section className="space-y-3">
              <h2 className="text-h2 font-semibold text-text">Background</h2>
              <ul className="space-y-2 text-body text-text">
                {tutor.education && (
                  <li className="flex items-center gap-2">
                    <GraduationCap className="size-5 text-text-muted" aria-hidden />
                    {tutor.education}
                  </li>
                )}
                {tutor.introVideoUrl && (
                  <li className="flex items-center gap-2">
                    <PlayCircle className="size-5 text-text-muted" aria-hidden />
                    <Link
                      href={tutor.introVideoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="focus-ring rounded-sm font-medium text-accent underline-offset-4 hover:underline"
                    >
                      Watch {name}&apos;s introduction
                    </Link>
                  </li>
                )}
              </ul>
            </section>
          )}
        </div>

        <aside id="book" className="scroll-mt-20 lg:sticky lg:top-20 lg:self-start">
          <div className="divide-y divide-border rounded-xl border border-border bg-surface-raised">
            <div className="p-5">{rate("lg")}</div>

            {/* Live broadcast (Phase 9 Part 3). Watching needs sign-in; the
                viewer page and the token route enforce it, not this link. */}
            {tutor.liveStatus === "live" && tutor.liveBroadcastId && (
              <div className="space-y-3 p-5">
                <h2 className="text-h3 font-semibold text-text">Broadcasting now</h2>
                <p className="text-small text-text-muted">
                  {name} is teaching a live lesson. Watching is free.
                </p>
                <Button asChild variant="secondary" className="w-full">
                  <Link href={`/live/${tutor.liveBroadcastId}`}>Watch live</Link>
                </Button>
              </div>
            )}

            {/* Instant session (SPEC §7.4). Shown only when the tutor is in the
                live_tutors view AND accepts instant; the action re-checks both
                server-side, so this is presentation and not the gate. Duration
                and price are pinned on the request row at request time, so the
                number on the button is exactly what an accept charges. The
                "Start now" heading is matched by E2E. */}
            {canRequestNow && (
              <section id="start-now" className="scroll-mt-20 space-y-4 p-5">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-h3 font-semibold text-text">Start now</h2>
                  <LiveChip size="sm" />
                </div>
                <InstantRequestWidget
                  tutorId={tutor.userId}
                  tutorName={name}
                  hourlyRateCredits={tutor.hourlyRateCredits}
                  durations={bookingSettings.sessionDurations}
                  subjects={bookableSubjects}
                  walletBalance={walletBalance}
                  mode={bookingMode}
                  loginHref={loginHref}
                  ttlSeconds={instantTtlSeconds}
                />
              </section>
            )}

            {/* Scheduled booking (SPEC §7.3). Slots computed server-side, rendered
                in the student's timezone; the action re-validates + re-prices. */}
            <section className="space-y-4 p-5">
              <h2 className="text-h3 font-semibold text-text">Book a session</h2>
              {calendar ? (
                <BookingWidget
                  tutorId={tutor.userId}
                  hourlyRateCredits={calendar.hourlyRateCredits}
                  durations={calendar.durations}
                  slotsByDuration={calendar.slotsByDuration}
                  subjects={bookableSubjects}
                  mode={bookingMode}
                  viewerTimeZone={viewerTimeZone}
                  tutorTimeZone={calendar.tutorTimeZone}
                  walletBalance={walletBalance}
                  loginHref={loginHref}
                  emphasis={canRequestNow ? "secondary" : "primary"}
                />
              ) : (
                <Alert variant="info">This tutor hasn’t opened any availability yet.</Alert>
              )}
            </section>

            {/* Messaging (Phase 9 Part 1). Only a student starts a conversation,
                so tutors, admins and the tutor viewing their own profile see
                nothing; signed-out visitors get a sign-in link. The action
                re-checks every rule server-side. */}
            {(bookingMode === "anon" || bookingMode === "student") && (
              <div className="space-y-2 p-5">
                <p className="text-small font-medium text-text">Have a question first?</p>
                <MessageTutorButton
                  tutorId={tutor.userId}
                  signedIn={bookingMode === "student"}
                  loginHref={loginHref}
                  className="w-full"
                />
              </div>
            )}

            <div className="space-y-1.5 p-5 text-small text-text-muted">
              <p className="inline-flex items-center gap-1.5">
                <ShieldCheck className="size-4 text-accent" aria-hidden />
                {TRUST_PAYMENT}
              </p>
              {TRUST_GUARANTEE_CONFIRMED && <p>{TRUST_GUARANTEE}</p>}
            </div>
          </div>
        </aside>
      </div>

      {/* Phones and tablets: the panel is below the fold, so the price and the
          one action stay reachable. Hidden on lg, where the panel is sticky. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface-raised px-4 py-3 lg:hidden">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-3">
          {rate("sm")}
          {canRequestNow ? (
            <Button asChild variant="live">
              <Link href="#start-now">Start now</Link>
            </Button>
          ) : (
            <Button asChild>
              <Link href="#book">Book a session</Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
