"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { GripHorizontal, Maximize2, Mic, MicOff, Video, VideoOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { VideoTile } from "@/components/features/session/video-tile";
import { SessionTimer } from "@/components/features/session/session-timer";
import { EndSessionButton } from "@/components/features/session/end-session-button";
import { qualityLevel } from "@/components/features/session/connection-banner";
import { QualityChip } from "@/components/features/session/room-chips";
import { useActiveSession } from "@/components/features/session/active-session";
import { useSnapDrag, type Corner } from "@/hooks/use-snap-drag";

/**
 * The instant session, small, on every page except its own room
 * (2026-09-29, Daniels: "a floating, draggable mini-player so an instant
 * session survives navigating away, with Enlarge back to the room").
 *
 * A view of `ActiveSessionProvider`, like the room: it holds no call state.
 * Shows the tutor's picture for both people (the student publishes audio
 * only, §9, so their tile would be an empty card), the other person's name
 * with a presence dot, the clock, mic (and camera for the tutor), Enlarge and
 * End. Drag the top strip, or use the arrow keys on it, to move it to another
 * corner; the corner is remembered for this browser.
 *
 * On a phone it sits above the bottom bar; it is `z-50`, over the bar (`z-40`)
 * and under dialogs. It is dark like the rooms (`.theme-dark`).
 *
 * After the session ends while the person is elsewhere, a one-line card says so
 * for a few seconds and then the provider forgets the session. Someone who saw
 * the ended screen in the room gets no second notice.
 */

export const ENDED_NOTICE_MS = 8000;

const cornerClass: Record<Corner, string> = {
  // Phones: under the 64px top bar and above the bottom bar (about 60px plus
  // the safe area). From md: 24px in from the edges, under the 76px top bar.
  tl: "left-3 top-[76px] md:left-6 md:top-[100px]",
  tr: "right-3 top-[76px] md:right-6 md:top-[100px]",
  bl: "left-3 bottom-[calc(76px+env(safe-area-inset-bottom))] md:left-6 md:bottom-6",
  br: "right-3 bottom-[calc(76px+env(safe-area-inset-bottom))] md:right-6 md:bottom-6",
};

export function MiniPlayer() {
  const session = useActiveSession();
  const pathname = usePathname() ?? "";
  const drag = useSnapDrag("br");
  const { meta, phase, finished, leave } = session;

  const inRoom = meta ? pathname === `/session/${meta.bookingId}` : false;

  // The ended screen in the room counts as the notice; don't repeat it here.
  const [endSeen, setEndSeen] = React.useState(false);
  React.useEffect(() => {
    if (!finished) setEndSeen(false);
    else if (inRoom) setEndSeen(true);
  }, [finished, inRoom]);

  // Ended while elsewhere: show the card for a while, then forget the session.
  // Ended and already seen in the room: forget it as soon as they leave the room.
  React.useEffect(() => {
    if (!finished || inRoom) return;
    if (endSeen) {
      leave("finished");
      return;
    }
    const timer = setTimeout(() => leave("finished"), ENDED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [finished, inRoom, endSeen, leave]);

  // Tell the toaster where the player is, so toasts don't land on it.
  const visible = !!meta && !inRoom && phase !== "idle" && !(finished && endSeen);
  const { setPlayerCorner } = session;
  React.useEffect(() => {
    setPlayerCorner(visible ? drag.corner : null);
  }, [visible, drag.corner, setPlayerCorner]);

  if (!meta || inRoom || phase === "idle") return null;
  if (finished && endSeen) return null;

  const bookings = meta.viewerIsTutor ? "/tutor/bookings" : "/dashboard/bookings";
  const roomHref = `/session/${meta.bookingId}`;

  const panel = (children: React.ReactNode) => (
    <div
      ref={drag.panelRef}
      role="region"
      aria-label="Current session"
      style={drag.style}
      className={cn(
        "theme-dark fixed z-50 w-[240px] overflow-hidden rounded-card border border-border bg-ground text-text shadow-lg md:w-[300px]",
        cornerClass[drag.corner],
        !drag.dragging && "transition-[top,bottom,left,right] duration-200 motion-reduce:transition-none",
        drag.dragging && "cursor-grabbing select-none",
      )}
    >
      {children}
    </div>
  );

  if (finished) {
    return panel(
      <div role="status" className="flex items-center justify-between gap-3 px-4 py-3">
        <p className="text-small font-medium">Session ended</p>
        <Link
          href={bookings}
          className="focus-ring rounded-sm text-small font-medium text-accent hover:underline"
        >
          Your bookings
        </Link>
      </div>,
    );
  }

  if (phase === "error") {
    return panel(
      <div role="alert" className="space-y-2 px-4 py-3">
        <p className="text-small font-medium">Your session disconnected</p>
        <Button asChild size="sm">
          <Link href={roomHref}>
            <Maximize2 aria-hidden />
            Back to the room
          </Link>
        </Button>
      </div>,
    );
  }

  const { viewerIsTutor, viewerName, viewerAvatarUrl, otherPartyName, otherPartyAvatarUrl } = meta;
  const live = phase === "live";
  // On a picture this small the chip only speaks up when the link is bad;
  // "Good connection" would just cover the tutor's face.
  const level = live && session.quality ? qualityLevel(Math.max(session.quality.uplink, session.quality.downlink)) : null;
  const chip = level && level !== "good" ? <QualityChip level={level} /> : null;

  // Same tile choice as the room's stage: the tutor's camera for both people.
  const tile = viewerIsTutor ? (
    <VideoTile
      compact
      overlay={chip}
      name={viewerName}
      roleLabel="You"
      avatarUrl={viewerAvatarUrl}
      track={session.cameraEnabled === false ? null : session.localVideo}
      muted={!session.micEnabled}
      emptyReason={live ? "camera-off" : "waiting"}
      className="aspect-video rounded-none border-0"
    />
  ) : (
    <VideoTile
      compact
      overlay={chip}
      name={otherPartyName}
      roleLabel="Tutor"
      avatarUrl={otherPartyAvatarUrl}
      track={session.remoteVideo}
      emptyReason={session.remotePresent ? "camera-off" : "waiting"}
      className="aspect-video rounded-none border-0"
    />
  );

  return panel(
    <>
      <div
        {...drag.handleProps}
        data-drag-handle=""
        role="button"
        tabIndex={0}
        aria-label="Move the session player. Arrow keys move it to another corner."
        className="focus-ring flex cursor-grab touch-none items-center gap-2 px-3 py-2"
      >
        <GripHorizontal className="size-4 shrink-0 text-text-muted" aria-hidden />
        <span
          aria-hidden
          className={cn("size-2 shrink-0 rounded-full", session.remotePresent ? "bg-live" : "bg-text-muted")}
        />
        <p className="min-w-0 flex-1 truncate text-small font-medium">
          {session.remotePresent ? otherPartyName : `Waiting for ${otherPartyName}…`}
        </p>
      </div>

      {tile}

      <div className="flex items-center justify-between gap-2 px-3 pt-2 [&_[role=timer]]:text-small">
        <SessionTimer
          deadline={session.deadline}
          durationMinutes={meta.durationMinutes}
          onStageChange={session.reportStage}
        />
      </div>

      <div role="toolbar" aria-label="Session controls" className="flex items-center gap-2 p-3">
        <Button
          variant="outline"
          size="icon"
          className="size-[38px]"
          aria-label="Microphone"
          aria-pressed={session.micEnabled}
          disabled={!live}
          onClick={() => void session.toggleMic()}
        >
          {session.micEnabled ? <Mic aria-hidden /> : <MicOff aria-hidden className="text-danger" />}
        </Button>
        {session.cameraEnabled !== null && (
          <Button
            variant="outline"
            size="icon"
            className="size-[38px]"
            aria-label="Camera"
            aria-pressed={session.cameraEnabled}
            disabled={!live}
            onClick={() => void session.toggleCamera()}
          >
            {session.cameraEnabled ? <Video aria-hidden /> : <VideoOff aria-hidden className="text-danger" />}
          </Button>
        )}
        <Button asChild variant="outline" size="sm" className="ml-auto">
          <Link href={roomHref} aria-label="Enlarge">
            <Maximize2 aria-hidden />
            <span className="hidden md:inline">Enlarge</span>
          </Link>
        </Button>
        <EndSessionButton compact bookingId={meta.bookingId} viewerIsTutor={viewerIsTutor} onEnded={session.finish} />
      </div>
    </>,
  );
}
