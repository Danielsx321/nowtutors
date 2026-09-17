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
 * research report 07). Anatomy, in order: photo with the green on-air ring
 * when instant-available, a live chip only when live (an offline tutor shows
 * no status text: absence is the signal), the favourite heart, name, country,
 * headline, proof row, one action. No rating until reviews exist, after
 * launch (SPEC §18).
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
  const rate = (
    <Money
      credits={tutor.hourlyRateCredits}
      usdPerCredit={usdPerCredit ?? undefined}
      showUsd={usdPerCredit != null}
      per="hr"
      size="sm"
    />
  );

  const chip =
    state === "instant" ? (
      <LiveChip size="sm" />
    ) : state === "broadcasting" ? (
      <Link
        href={`/live/${tutor.liveBroadcastId}`}
        aria-label={`LIVE, watch ${name}'s broadcast`}
        className="focus-ring relative z-10 inline-flex rounded-full"
      >
        <LiveChip size="sm" label="LIVE" />
      </Link>
    ) : null;

  const action =
    state === "instant" ? (
      <Button asChild variant="live" size="sm" className="relative z-10">
        <Link href={`${profileHref}#start-now`}>Request now</Link>
      </Button>
    ) : state === "broadcasting" ? (
      <Button asChild variant="secondary" size="sm" className="relative z-10">
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
      className="focus-ring rounded-sm after:absolute after:inset-0 after:rounded-xl"
    >
      {name}
    </Link>
  );

  if (variant === "row") {
    return (
      <article
        data-state={state}
        className="relative flex gap-3 rounded-xl border border-border bg-surface-raised p-2 transition-colors hover:border-border-strong"
      >
        <OnAirRing
          active={state === "instant"}
          className="block shrink-0 self-start rounded-lg ring-offset-2 ring-offset-surface-raised"
        >
          <TutorPhoto
            src={tutor.avatarUrl}
            name={name}
            sizes="88px"
            className="size-[88px]"
            initialsClassName="text-h2"
          />
        </OnAirRing>
        <div className="flex min-w-0 flex-1 flex-col gap-1 py-0.5 pr-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate font-display text-body-lg font-semibold text-text">{title}</h3>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {chip}
                {tutor.country && (
                  <span className="text-caption text-text-muted">{tutor.country}</span>
                )}
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
            {rate}
            {action}
          </div>
        </div>
      </article>
    );
  }

  return (
    <article
      data-state={state}
      className="relative flex flex-col rounded-xl border border-border bg-surface-raised p-2 transition-colors hover:border-border-strong"
    >
      {/* Static ring in a grid: many pulsing rings at once is noise; the chip carries the word. */}
      <OnAirRing
        active={state === "instant"}
        still
        className="block rounded-lg ring-offset-2 ring-offset-surface-raised"
      >
        <TutorPhoto
          src={tutor.avatarUrl}
          name={name}
          sizes="(min-width: 1024px) 320px, (min-width: 768px) 45vw, 100vw"
          className="aspect-[4/3] w-full"
          initialsClassName="text-display"
        />
        {chip && <div className="absolute left-2 top-2">{chip}</div>}
        <div className="absolute right-2 top-2">{heart}</div>
      </OnAirRing>

      <div className="flex flex-1 flex-col gap-3 px-2 pb-2 pt-3">
        <div className="space-y-1">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="truncate font-display text-h3 font-semibold text-text">{title}</h3>
            {tutor.country && (
              <span className="shrink-0 text-caption text-text-muted">{tutor.country}</span>
            )}
          </div>
          {tutor.headline && (
            <p className="line-clamp-2 min-h-10 text-small text-text-muted">{tutor.headline}</p>
          )}
        </div>

        <StatRow
          size="sm"
          stats={[
            { label: "Experience", value: experienceValue(tutor.yearsExperience) },
            { label: "Sessions", value: sessionsValue(tutor.completedSessions) },
            { label: "Rate", value: rate },
          ]}
        />

        {/* One action, full width on the card. */}
        <div className="mt-auto [&>*]:w-full">{action}</div>
      </div>
    </article>
  );
}
