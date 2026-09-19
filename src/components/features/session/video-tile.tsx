"use client";

import * as React from "react";
import { Mic, MicOff, VideoOff } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * `VideoTile` (SPEC §10.2): one participant's frame. Rooms render inside
 * `.theme-dark`, so the raised surface is the dark one and the name label sits
 * on the canvas colour at 80% over the picture.
 *
 * The Agora track is *played* here rather than in the room component: attaching a
 * media track to an element is a rendering concern, and keeping it next to the
 * element means the detach happens in the same place, on the same unmount.
 */

/**
 * The slice of an Agora track this component needs. Structural rather than an
 * `ICameraVideoTrack` import so the tile carries no dependency on the SDK — it
 * renders a track, it does not know where one comes from.
 */
export interface PlayableVideoTrack {
  play(element: HTMLElement): void;
  stop(): void;
}

export interface VideoTileProps {
  name: string;
  /** Null when this participant publishes no video, or has not arrived. */
  track?: PlayableVideoTrack | null;
  /** Shown when there is no track: why there is no picture. */
  emptyReason: "audio-only" | "waiting" | "camera-off";
  /** Small tag under the name — "You", "Tutor", "Student". */
  roleLabel?: string;
  avatarUrl?: string | null;
  muted?: boolean;
  /** The big tile. The other is a companion, sized down. */
  primary?: boolean;
  /** Small picture-in-picture tile: compact label, no avatar caption. */
  compact?: boolean;
  /** Pinned to the top-left of the picture: the room's connection chip. */
  overlay?: React.ReactNode;
  className?: string;
}

const emptyCopy: Record<VideoTileProps["emptyReason"], string> = {
  "audio-only": "Audio only",
  waiting: "Waiting to join…",
  "camera-off": "Camera off",
};

export function VideoTile({
  name,
  track,
  emptyReason,
  roleLabel,
  avatarUrl,
  muted,
  primary,
  compact,
  overlay,
  className,
}: VideoTileProps) {
  const mountRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = mountRef.current;
    if (!track || !el) return;
    track.play(el);
    // Detaching on unmount AND whenever the track changes. The track's own
    // lifecycle (close, and with it the camera light) belongs to SessionClient;
    // this only ever stops the playback this effect started.
    return () => {
      try {
        track.stop();
      } catch {
        // Track already closed by the session teardown — nothing to detach.
      }
    };
  }, [track]);

  return (
    <div
      className={cn(
        // v2 room (session-room mockup): the stage is a 26px panel with no
        // border; a picture-in-picture tile is 16px with a ground-coloured
        // edge so it reads as lifted off the stage.
        "relative w-full overflow-hidden bg-surface-raised",
        primary
          ? "aspect-video rounded-panel"
          : compact
            ? "aspect-[16/10] rounded-[16px] border-2 border-ground"
            : "aspect-video rounded-card sm:aspect-[4/3]",
        className,
      )}
    >
      {/* Agora renders its own <video> into this element. */}
      <div ref={mountRef} className="absolute inset-0 [&_video]:object-cover" />

      {!track && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
          <Avatar
            src={avatarUrl ?? undefined}
            name={name}
            size={primary ? "xl" : compact ? "sm" : "md"}
          />
          <div className={cn("flex items-center gap-2 text-text-muted", compact && "sr-only")}>
            {emptyReason === "audio-only" ? (
              <Mic className="size-4" aria-hidden />
            ) : (
              <VideoOff className="size-4" aria-hidden />
            )}
            <span className="text-small">{emptyCopy[emptyReason]}</span>
          </div>
        </div>
      )}

      {overlay && <div className="absolute left-3 top-3 md:left-[18px] md:top-[18px]">{overlay}</div>}

      <div
        className={cn(
          "absolute bottom-0 left-0 flex max-w-full items-center gap-2 bg-ground/70",
          compact ? "rounded-tr-[10px] px-2.5 py-1.5" : "rounded-tr-[14px] px-4 py-2.5",
        )}
      >
        <p className={cn("truncate font-medium text-text", compact ? "text-caption" : "text-small")}>
          {name}
          {roleLabel && <span className="ml-2 text-text-muted">{roleLabel}</span>}
        </p>
        {muted && <MicOff className="size-4 shrink-0 text-danger" aria-label="Muted" />}
      </div>
    </div>
  );
}
