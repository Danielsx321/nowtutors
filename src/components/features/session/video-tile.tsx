"use client";

import * as React from "react";
import { Mic, MicOff, VideoOff } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * `VideoTile` (SPEC §10.2) — one participant's frame on the ink surface.
 *
 * An ink card: `ink-900` fill with an `ink-700` border, because there is no
 * lighter ink to elevate onto (§10.1). White label text (9.29:1), `ink-300` for
 * the secondary line (4.69:1).
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
        "relative overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-sm",
        primary ? "aspect-video w-full" : "aspect-video w-full sm:aspect-[4/3]",
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
            size={primary ? "lg" : "md"}
          />
          <div className="flex items-center gap-2 text-ink-300">
            {emptyReason === "audio-only" ? (
              <Mic className="size-4" aria-hidden />
            ) : (
              <VideoOff className="size-4" aria-hidden />
            )}
            <span className="text-small">{emptyCopy[emptyReason]}</span>
          </div>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-ink-950/80 px-3 py-2">
        <p className="truncate text-small font-medium text-white">
          {name}
          {roleLabel && <span className="ml-2 text-ink-300">{roleLabel}</span>}
        </p>
        {muted && (
          <MicOff className="size-4 shrink-0 text-ink-300" aria-label="Muted" />
        )}
      </div>
    </div>
  );
}
