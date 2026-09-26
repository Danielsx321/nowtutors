import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LiveChip } from "@/components/ui/live-chip";
import { TutorPhoto } from "@/components/features/tutor-photo";
import { FavouriteHeart, type FavouriteMode } from "@/components/features/favourite-heart";
import { ViewerStage } from "@/components/features/broadcasts/viewer-stage";

export type StageMode =
  /** The tutor's photo, large. */
  | { kind: "photo" }
  /** The tutor is broadcasting; this viewer can't watch here, so the photo carries a LIVE overlay and a link. */
  | { kind: "overlay"; broadcastId: string }
  /** A signed-in student on a broadcasting tutor's profile: the player itself. */
  | { kind: "embed"; broadcastId: string; viewerKey: string };

/**
 * The profile's stage (DESIGN.md v3 "Public pages"; design round 3 Part E,
 * after Oranum's expert page, where the left column is the live video). Three
 * states, chosen by the page: the photo; the photo dimmed under a LIVE chip and
 * a "Watch live" link when the tutor is broadcasting and this viewer isn't
 * admitted to the player here (signed out, a tutor, the host); and the
 * broadcast player itself for a signed-in student, inside a dark island like
 * the viewer page. The token route still gates the player server-side, so the
 * embed is presentation, not the door.
 */
export function ProfileStage({
  mode,
  tutorId,
  tutorName,
  tutorSlug,
  avatarUrl,
  instantAvailable,
  isFavourited,
  favouriteMode,
  loginHref,
}: {
  mode: StageMode;
  tutorId: string;
  tutorName: string;
  tutorSlug: string;
  avatarUrl: string | null;
  /** Draws the on-air ring, as the card does. */
  instantAvailable: boolean;
  isFavourited: boolean;
  favouriteMode: FavouriteMode;
  loginHref: string;
}) {
  const heart = (
    <div className="absolute right-3.5 top-3.5 z-10">
      <FavouriteHeart
        tutorId={tutorId}
        initialFavourited={isFavourited}
        mode={favouriteMode}
        loginHref={loginHref}
      />
    </div>
  );

  if (mode.kind === "embed") {
    return (
      <div data-stage="embed" className="theme-dark overflow-hidden rounded-panel bg-ground p-3 text-text">
        <ViewerStage
          broadcastId={mode.broadcastId}
          tutorName={tutorName}
          tutorAvatarUrl={avatarUrl}
          tutorSlug={tutorSlug}
          viewerKey={mode.viewerKey}
        />
      </div>
    );
  }

  return (
    <div
      data-stage={mode.kind}
      className={cn(
        "relative overflow-hidden rounded-panel",
        instantAvailable && "ring-[3px] ring-live ring-offset-[3px] ring-offset-ground",
      )}
    >
      <TutorPhoto
        src={avatarUrl}
        name={tutorName}
        sizes="(min-width: 1024px) 760px, 100vw"
        className={cn("aspect-[16/9] w-full rounded-panel", mode.kind === "overlay" && "[&_img]:brightness-[0.55]")}
        initialsClassName="text-[96px]"
      />
      {heart}
      {instantAvailable && mode.kind === "photo" && (
        <div className="absolute left-3.5 top-3.5 z-10">
          <LiveChip className="bg-surface-raised" />
        </div>
      )}
      {mode.kind === "overlay" && (
        <>
          <div className="absolute left-3.5 top-3.5 z-10">
            <LiveChip label="LIVE" className="bg-surface-raised" />
          </div>
          <div className="absolute inset-0 z-10 grid place-items-center">
            <Button asChild variant="highlight" size="lg">
              <Link href={`/live/${mode.broadcastId}`}>Watch live</Link>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
