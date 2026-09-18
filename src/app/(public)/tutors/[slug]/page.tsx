import * as React from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { CreditCard, GraduationCap, PlayCircle, ShieldCheck } from "lucide-react";
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
import { countryName } from "@/lib/geo/country-centroids";
import { slotsForWeek, weekAvailability } from "@/lib/tutors/week-availability";
import { BookingWidget, type BookingMode } from "@/components/features/booking/booking-widget";
import { InstantRequestWidget } from "@/components/features/booking/instant-request-widget";
import { LiveChip } from "@/components/ui/live-chip";
import { Money } from "@/components/ui/money";
import { StatRow } from "@/components/ui/stat-row";
import { TutorPhoto } from "@/components/features/tutor-photo";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FavouriteHeart, type FavouriteMode } from "@/components/features/favourite-heart";
import { MessageTutorButton } from "@/components/features/messaging/message-tutor-button";
import { cn } from "@/lib/utils";

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
 * Layout (live-globe rebuild Part D; pages.html, Tutor profile): a header with
 * the square photo (a green ring outside a ground-coloured gap when the tutor
 * can be requested now), the live chip, the name at display size and a meta
 * line (country, languages, first subjects); the proof row; About, Subjects,
 * This week (open slots per day, from the same calendar the panel books
 * from) and Background as white blocks; then a sticky panel on `lg` (rate,
 * Start now when instant-available, Book a session, Message, trust lines) and
 * a sticky bottom bar on smaller screens that jumps to it. One primary action:
 * when "Start now" is on offer it is the teal one and booking steps back to
 * outline.
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
  const broadcasting = tutor.liveStatus === "live" && !!tutor.liveBroadcastId;

  const name = tutor.displayName ?? "Tutor";
  const firstName = name.trim().split(/\s+/)[0] || name;
  const country = countryName(tutor.country);
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

  const week = calendar
    ? weekAvailability(slotsForWeek(calendar.slotsByDuration, calendar.durations), viewerTimeZone, new Date())
    : null;

  return (
    <div className="mx-auto w-full max-w-[var(--container-page)] px-4 pb-28 pt-6 md:px-6 lg:pb-20">
      <div className="grid gap-8 lg:grid-cols-[1fr_380px] lg:items-start">
        <div className="grid min-w-0 gap-[18px]">
          <header className="grid gap-6 sm:grid-cols-[220px_1fr] sm:items-end">
            <div
              className={cn(
                "relative w-44 rounded-[24px] sm:w-full",
                canRequestNow && "ring-[3px] ring-live ring-offset-[3px] ring-offset-ground",
              )}
            >
              <TutorPhoto
                src={tutor.avatarUrl}
                name={name}
                sizes="220px"
                className="aspect-square w-full rounded-[24px]"
                initialsClassName="text-display"
              />
              <div className="absolute right-3 top-3">
                <FavouriteHeart
                  tutorId={tutor.userId}
                  initialFavourited={tutor.isFavourited}
                  mode={favouriteMode}
                  loginHref={loginHref}
                />
              </div>
            </div>
            <div className="min-w-0">
              {(canRequestNow || broadcasting) && (
                <div className="mb-2.5 flex flex-wrap items-center gap-2">
                  {canRequestNow && <LiveChip />}
                  {broadcasting && (
                    <Link
                      href={`/live/${tutor.liveBroadcastId}`}
                      aria-label={`LIVE, watch ${name}'s broadcast`}
                      className="focus-ring inline-flex rounded-full"
                    >
                      <LiveChip label="LIVE" />
                    </Link>
                  )}
                </div>
              )}
              <h1 className="mb-2 font-display text-[clamp(38px,5vw,60px)] font-medium leading-none tracking-[-0.035em] text-text">
                {name}
              </h1>
              {tutor.headline && <p className="mb-2 text-body-lg text-text">{tutor.headline}</p>}
              <MetaLine
                items={[country, tutor.languages.length > 0 ? tutor.languages.join(", ") : null]}
                tags={subjects.slice(0, 2).map((s) => s.name)}
              />
            </div>
          </header>

          <StatRow
            className="bg-surface-raised"
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
              {
                label: "Rate",
                value: (
                  <Money
                    credits={tutor.hourlyRateCredits}
                    usdPerCredit={usdPerCredit ?? undefined}
                    showUsd={usdPerCredit != null}
                    per="hr"
                    size="md"
                    stacked
                  />
                ),
              },
            ]}
          />

          {tutor.about && (
            <Block title={`About ${firstName}`}>
              <p className="max-w-[68ch] whitespace-pre-line text-body text-text">{tutor.about}</p>
            </Block>
          )}

          {subjects.length > 0 && (
            <Block title="Subjects">
              <div className="flex flex-wrap gap-2">
                {subjects.map((s) => (
                  <Tag key={s.slug}>
                    {s.name}
                    {s.level && ` · ${LEVEL_LABEL[s.level] ?? s.level}`}
                  </Tag>
                ))}
              </div>
            </Block>
          )}

          {week && (
            <Block title="This week">
              <ol className="grid grid-cols-7 gap-1.5 text-center text-caption" aria-label="Open times this week">
                {week.map((d) => (
                  <li
                    key={d.key}
                    aria-label={`${d.weekday} ${d.date}: ${d.slots} open ${d.slots === 1 ? "time" : "times"}`}
                    className={cn(
                      "rounded-md border px-1 py-2",
                      d.slots > 0 ? "border-primary text-primary" : "border-border text-text-muted",
                    )}
                  >
                    {d.weekday}
                    <b data-numeric className="block font-display text-body font-semibold">
                      {d.slots}
                    </b>
                    <span className="hidden sm:inline">{d.slots === 1 ? "slot" : "slots"}</span>
                  </li>
                ))}
              </ol>
              <p className="text-caption text-text-muted">Open start times per day, in your timezone ({viewerTimeZone}).</p>
            </Block>
          )}

          {(tutor.education || tutor.introVideoUrl) && (
            <Block title="Background">
              <ul className="space-y-2 text-body text-text">
                {tutor.education && (
                  <li className="flex items-center gap-2">
                    <GraduationCap className="size-5 shrink-0 text-accent" aria-hidden strokeWidth={1.75} />
                    {tutor.education}
                  </li>
                )}
                {tutor.introVideoUrl && (
                  <li className="flex items-center gap-2">
                    <PlayCircle className="size-5 shrink-0 text-accent" aria-hidden strokeWidth={1.75} />
                    <Link
                      href={tutor.introVideoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="focus-ring rounded-sm font-medium text-accent underline-offset-4 hover:underline"
                    >
                      Watch {firstName}&apos;s introduction
                    </Link>
                  </li>
                )}
              </ul>
            </Block>
          )}
        </div>

        <aside id="book" className="scroll-mt-24 lg:sticky lg:top-24">
          <div className="divide-y divide-border overflow-hidden rounded-panel border border-border bg-surface-raised">
            <div className="space-y-1 p-[22px]">
              <p className="text-small text-text-muted">Rate</p>
              {rate("lg")}
            </div>

            {/* Live broadcast (Phase 9 Part 3). Watching needs sign-in; the
                viewer page and the token route enforce it, not this link. */}
            {broadcasting && (
              <div className="space-y-3 p-[22px]">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-display text-h3 font-semibold text-text">Broadcasting now</h2>
                  <LiveChip size="sm" label="LIVE" />
                </div>
                <p className="text-small text-text-muted">
                  {firstName} is teaching a live lesson. Watching is free.
                </p>
                <Button asChild variant="outline" className="w-full">
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
              <section id="start-now" className="scroll-mt-24 space-y-3.5 p-[22px]">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-display text-h3 font-semibold text-text">Start now</h2>
                  <LiveChip size="sm" label="Live" />
                </div>
                <InstantRequestWidget
                  tutorId={tutor.userId}
                  tutorName={name}
                  tutorAvatarUrl={tutor.avatarUrl}
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
            <section className="space-y-3 p-[22px]">
              <h2 className="font-display text-h3 font-semibold text-text">Book a session</h2>
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
                  emphasis={canRequestNow ? "outline" : "primary"}
                />
              ) : (
                <Alert variant="info">This tutor hasn’t opened any availability yet.</Alert>
              )}
            </section>

            {/* Messaging (Phase 9 Part 1) and the trust lines. Only a student
                starts a conversation, so tutors, admins and the tutor viewing
                their own profile see no button; signed-out visitors get a
                sign-in link. The action re-checks every rule server-side. */}
            <div className="space-y-2.5 p-[22px]">
              {(bookingMode === "anon" || bookingMode === "student") && (
                <MessageTutorButton
                  tutorId={tutor.userId}
                  signedIn={bookingMode === "student"}
                  loginHref={loginHref}
                  className="w-full"
                />
              )}
              {TRUST_GUARANTEE_CONFIRMED && (
                <p className="flex items-center gap-2 text-small text-text-muted">
                  <ShieldCheck className="size-[18px] shrink-0 text-accent" aria-hidden strokeWidth={1.75} />
                  {TRUST_GUARANTEE}
                </p>
              )}
              <p className="flex items-center gap-2 text-small text-text-muted">
                <CreditCard className="size-[18px] shrink-0 text-accent" aria-hidden strokeWidth={1.75} />
                {TRUST_PAYMENT}
              </p>
            </div>
          </div>
        </aside>
      </div>

      {/* Phones and tablets: the panel is below the fold, so the price and the
          one action stay reachable. Hidden on lg, where the panel is sticky. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface-raised px-4 py-3 lg:hidden">
        <div className="mx-auto flex max-w-[var(--container-page)] items-center justify-between gap-3">
          {rate("sm")}
          <Button asChild variant="primary">
            {canRequestNow ? <Link href="#start-now">Start now</Link> : <Link href="#book">Book a session</Link>}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** A white content block on the profile (pages.html `.p-block`). */
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3 rounded-card border border-border bg-surface-raised p-6">
      <h2 className="font-display text-[20px] font-semibold tracking-[-0.01em] text-text">{title}</h2>
      {children}
    </section>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-surface-raised px-2.5 py-0.5 text-small font-medium text-text">
      {children}
    </span>
  );
}

/** "Italy · English, Italian · [GCSE Maths] [A-level]", skipping whatever is missing. */
function MetaLine({ items, tags }: { items: (string | null)[]; tags: string[] }) {
  const parts = items.filter((x): x is string => !!x);
  if (parts.length === 0 && tags.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-body text-text-muted">
      {parts.map((p, i) => (
        <React.Fragment key={p}>
          {i > 0 && <span aria-hidden>·</span>}
          <span>{p}</span>
        </React.Fragment>
      ))}
      {parts.length > 0 && tags.length > 0 && <span aria-hidden>·</span>}
      {tags.map((t) => (
        <Tag key={t}>{t}</Tag>
      ))}
    </div>
  );
}
