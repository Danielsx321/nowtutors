"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VideoTile, type PlayableVideoTrack } from "@/components/features/session/video-tile";
import { LiveClient, type BroadcastTokenGrant } from "@/lib/agora/live-client";
import { useBroadcastPresence } from "@/hooks/use-broadcast-presence";
import { useTokenRenewal } from "@/hooks/use-token-renewal";
import { getBroadcastWatchable } from "@/actions/broadcasts";

export interface ViewerStageProps {
  broadcastId: string;
  tutorName: string;
  tutorAvatarUrl?: string | null;
  /** The viewer's Agora uid as a string: their Presence key, so two tabs count once. */
  viewerKey: string;
}

type Phase = "connecting" | "live" | "ended" | "error";

/**
 * A signed-in viewer watching a broadcast (SPEC §7.8; Phase 9 Part 3).
 *
 * Joins as Agora audience with a `subscriber` token, publishes nothing, and asks
 * for no camera or microphone. Tracks itself in Presence so the host's count
 * includes it.
 *
 * **"Ended" is learned without polling.** When Agora reports the host left the
 * channel, or a token renewal is refused, the page asks the server once
 * (`getBroadcastWatchable`). If the broadcast is over, the stage says so and
 * leaves the channel; if not (a host reconnecting), it keeps waiting. A token
 * refused at join is the same answer.
 */
export function ViewerStage({ broadcastId, tutorName, tutorAvatarUrl, viewerKey }: ViewerStageProps) {
  const [phase, setPhase] = React.useState<Phase>("connecting");
  const [error, setError] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const [hostVideo, setHostVideo] = React.useState<PlayableVideoTrack | null>(null);
  const [hostPresent, setHostPresent] = React.useState(false);
  const [tokenExpiresAt, setTokenExpiresAt] = React.useState<string | null>(null);
  const clientRef = React.useRef<LiveClient | null>(null);

  const markEnded = React.useCallback(() => {
    setPhase("ended");
    void clientRef.current?.leave();
  }, []);

  const checkEnded = React.useCallback(async () => {
    try {
      const { watchable } = await getBroadcastWatchable({ broadcastId });
      if (!watchable) markEnded();
    } catch {
      // Unknown: keep the stage up. The next host event or renewal asks again.
    }
  }, [broadcastId, markEnded]);

  const { count } = useBroadcastPresence(phase === "ended" ? null : broadcastId, { viewerKey });

  React.useEffect(() => {
    const client = new LiveClient({
      onHostVideo: setHostVideo,
      onHostPresence: (present) => {
        setHostPresent(present);
        if (!present) void checkEnded();
      },
    });
    clientRef.current = client;
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/agora/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ broadcastId }),
          cache: "no-store",
        });
        const body: unknown = await res.json().catch(() => null);
        if (cancelled) return;
        if (res.status === 404) {
          markEnded();
          return;
        }
        if (!res.ok) {
          const message = (body as { error?: unknown } | null)?.error;
          setError(typeof message === "string" ? message : "Couldn't open this broadcast.");
          setPhase("error");
          return;
        }
        const grant = body as BroadcastTokenGrant;
        await client.join(grant);
        if (cancelled || client.disposed) return;
        setTokenExpiresAt(grant.expiresAt);
        setPhase("live");
      } catch {
        if (cancelled) return;
        setError("Couldn't connect to the broadcast.");
        setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
      if (clientRef.current === client) clientRef.current = null;
      void client.leave();
    };
  }, [broadcastId, attempt, checkEnded, markEnded]);

  const handleRenewed = React.useCallback(async (grant: BroadcastTokenGrant) => {
    try {
      await clientRef.current?.renewToken(grant.token);
      setTokenExpiresAt(grant.expiresAt);
    } catch {
      void checkEnded();
    }
  }, [checkEnded]);

  const handleRefused = React.useCallback(() => void checkEnded(), [checkEnded]);

  useTokenRenewal<BroadcastTokenGrant>(
    { broadcastId },
    phase === "live" ? tokenExpiresAt : null,
    handleRenewed,
    handleRefused,
  );

  if (phase === "ended") {
    return (
      <div className="rounded-lg border border-ink-700 bg-ink-900 p-6 shadow-sm" data-broadcast-ended>
        <h2 className="text-h3 font-bold text-white">This broadcast has ended</h2>
        <p className="mt-2 max-w-prose text-body text-ink-300">
          {tutorName} isn&apos;t live any more. See who else is teaching right now.
        </p>
        <Button asChild variant="ink" className="mt-4">
          <Link href="/live">Live now</Link>
        </Button>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="rounded-lg border border-danger/30 bg-danger/10 p-6">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
          <div className="min-w-0">
            <p className="font-bold text-gray-700">Couldn&apos;t open the broadcast</p>
            <p className="mt-1 text-body text-gray-700">{error}</p>
            <Button
              className="mt-4"
              onClick={() => {
                setError(null);
                setHostVideo(null);
                setHostPresent(false);
                setTokenExpiresAt(null);
                setPhase("connecting");
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <VideoTile
        primary
        name={tutorName}
        roleLabel="Tutor"
        avatarUrl={tutorAvatarUrl}
        track={hostVideo}
        emptyReason={hostPresent ? "camera-off" : "waiting"}
      />
      <p className="inline-flex items-center gap-1.5 text-small text-gray-500" data-viewer-count={count}>
        <Users className="size-4" aria-hidden />
        {count} watching
      </p>
    </div>
  );
}
