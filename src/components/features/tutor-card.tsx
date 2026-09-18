import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LiveChip } from "@/components/ui/live-chip";
import { Money } from "@/components/ui/money";
import { StatRow } from "@/components/ui/stat-row";
import { OnAirRing } from "@/components/ui/on-air-ring";
import { TutorPhoto } from "@/components/features/tutor-photo";
import {
  FavouriteHeart,
  type FavouriteMode,
} from "@/components/features/favourite-heart";
import type { TutorCardData } from "@/db/queries/tutors";
import { countryName } from "@/lib/geo/country-centroids";

export interface TutorCardProps {
  tutor: TutorCardData;
  favouriteMode: FavouriteMode;
  loginHref?: string;
  /** USD per credit from the direct-pay basis package, for the "≈ $" anchor. Null hides it. */
  usdPerCredit?: number | null;
  /** `grid` (default) for `md` and up; `row` for phones. */
  variant?: "grid" | "row";
}

/** Which of the three card states a tutor is in (DESIGN.md, "The live signal"). */
function cardState(t: TutorCardData) {
  // Instant-available: in live_tutors for instant sessions AND takes requests.
  // Live status comes from the live_tutors view, never is_live (SPEC §3.1).
  if (t.liveStatus === "online" && t.acceptsInstant) return "instant" as const;
  if (t.liveStatus === "live" && t.liveBroadcastId) return "broadcasting" as const;
  return "offline" as const;
}

function experienceValue(years: number | null) {
  return years && years > 0 ? `${years}y` : "New";
}

function sessionsValue(n: number) {
  return n > 0 ? n.toLocaleString() : "New";
}

/**
 * The tutor card, the product's first impression (DESIGN.md, "Cards";
 * pages.html, live-globe rebuild Part D). Anatomy, in order: a white card with
 * a 10px inset photo (the green on-air ring when instant-available), the live
 * chip on the photo only when live (an offline tutor shows no status text:
 * absence is the signal), the favourite heart, name and country on one line,
 * the one-line pitch, the first subject as a tag, the three-cell proof row,
 * one full-width action. No rating until reviews exist, after launch (SPEC §18).
 *
 * The action follows the state: teal "Request now" when a request can start a
 * session this minute, outline "Watch live" for a broadcast, ink "Book a
 * session" otherwise (ink, not teal, so the card doesn't compete with the
 * page's own primary action).
 *
 * The whole card links to the profile through a stretched link on the name;
 * the chip, heart and action sit above it (z-10) so they stay clickable.
 */
export function TutorCard({
  tutor,
  favouriteMode,
  loginHref,
  usdPerCredit = null,
  variant = "grid",
}: TutorCardProps) {
  const name = tutor.displayName ?? "Tutor";
  const profileHref = `/tutors/${tutor.slug}`;
  const state = cardState(tutor);
  const country = countryName(tutor.country);
  const subject = tutor.subjects[0] ?? null;

  const chip =
    state === "instant" ? (
      <LiveChip size="sm" className="bg-surface-raised" />
    ) : state === "broadcasting" ? (
      <Link
        href={`/live/${tutor.liveBroadcastId}`}
        aria-label={`LIVE, watch ${name}'s broadcast`}
        className="focus-ring relative z-10 inline-flex rounded-full"
      >
        <LiveChip size="sm" label="LIVE" className="bg-surface-raised" />
      </Link>
    ) : null;

  const action =
    state === "instant" ? (
      <Button asChild variant="primary" size="sm" className="relative z-10">
        <Link href={`${profileHref}#start-now`}>Request now</Link>
      </Button>
    ) : state === "broadcasting" ? (
      <Button asChild variant="outline" size="sm" className="relative z-10">
        <Link href={`/live/${tutor.liveBroadcastId}`}>Watch live</Link>
      </Button>
    ) : (
      <Button asChild variant="ink" size="sm" className="relative z-10">
        <Link href={profileHref}>Book a session</Link>
      </Button>
    );

  const heart = (
    <FavouriteHeart
      tutorId={tutor.userId}
      initialFavourited={tutor.isFavourited}
      mode={favouriteMode}
      loginHref={loginHref}
      className="relative z-10"
    />
  );

  const title = (
    <Link
      href={profileHref}
      className="focus-ring rounded-sm after:absolute after:inset-0 after:rounded-card"
    >
      {name}
    </Link>
  );

  const cardClass =
    "relative rounded-card border border-border bg-surface-raised p-2.5 transition-[transform,box-shadow] duration-200 motion-safe:hover:-translate-y-[3px] hover:shadow-lift";

  if (variant === "row") {
    return (
      <article data-state={state} className={`${cardClass} flex gap-3`}>
        <OnAirRing active={state === "instant"} className="block shrink-0 self-start rounded-photo">
          <TutorPhoto
            src={tutor.avatarUrl}
            name={name}
            sizes="88px"
            className="size-[88px] rounded-photo"
            initialsClassName="text-h2"
          />
        </OnAirRing>
        <div className="flex min-w-0 flex-1 flex-col gap-1 py-0.5 pr-0.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate font-display text-body-lg font-semibold text-text">{title}</h3>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {chip}
                {country && <span className="text-caption text-text-muted">{country}</span>}
              </div>
            </div>
            {heart}
          </div>
          <p data-numeric className="text-small text-text-muted">
            {experienceValue(tutor.yearsExperience) === "New"
              ? "New tutor"
              : `${tutor.yearsExperience}y experience`}
            {" · "}
            {tutor.completedSessions > 0
              ? `${tutor.completedSessions.toLocaleString()} sessions`
              : "No sessions yet"}
          </p>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
            <Money
              credits={tutor.hourlyRateCredits}
              usdPerCredit={usdPerCredit ?? undefined}
              showUsd={usdPerCredit != null}
              per="hr"
              size="sm"
            />
            {action}
          </div>
        </div>
      </article>
    );
  }

  return (
    <article data-state={state} className={`${cardClass} flex flex-col gap-3`}>
      {/* Static ring in a grid: many pulsing rings at once is noise; the chip carries the word. */}
      <OnAirRing active={state === "instant"} still className="block rounded-photo">
        <TutorPhoto
          src={tutor.avatarUrl}
          name={name}
          sizes="(min-width: 1280px) 290px, (min-width: 1024px) 33vw, (min-width: 768px) 45vw, 100vw"
          className="aspect-[4/3.1] w-full rounded-photo"
          initialsClassName="text-display"
        />
        {chip && <div className="absolute left-2.5 top-2.5">{chip}</div>}
        <div className="absolute right-2.5 top-2.5">{heart}</div>
      </OnAirRing>

      <div className="flex flex-1 flex-col gap-2.5 px-1.5 pb-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="truncate font-display text-[19px] font-semibold leading-tight tracking-[-0.01em] text-text">
            {title}
          </h3>
          {country && (
            <span className="max-w-[45%] shrink-0 truncate text-caption font-medium text-text-muted">
              {country}
            </span>
          )}
        </div>
        <p className="line-clamp-2 min-h-[42px] text-small text-text-muted">{tutor.headline ?? ""}</p>
        {subject && (
          <span className="self-start rounded-full border border-border bg-surface-raised px-2.5 py-0.5 text-caption font-medium text-text">
            {subject}
          </span>
        )}

        <StatRow
          size="sm"
          stats={[
            { label: "Experience", value: experienceValue(tutor.yearsExperience) },
            { label: "Sessions", value: sessionsValue(tutor.completedSessions) },
            {
              label: "Rate",
              value: (
                <Money
                  credits={tutor.hourlyRateCredits}
                  usdPerCredit={usdPerCredit ?? undefined}
                  showUsd={usdPerCredit != null}
                  per="hr"
                  size="sm"
                  stacked
                />
              ),
            },
          ]}
        />

        {/* One action, full width on the card. */}
        <div className="mt-auto [&>*]:w-full">{action}</div>
      </div>
    </article>
  );
}
