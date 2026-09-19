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
  /** For "Book a 1:1" when the class ends. */
  tutorSlug?: string | null;
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
export function ViewerStage({ broadcastId, tutorName, tutorAvatarUrl, tutorSlug, viewerKey }: ViewerStageProps) {
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
    return <BroadcastEnded tutorName={tutorName} tutorSlug={tutorSlug} />;
  }

  if (phase === "error") {
    return (
      <div role="alert" className="rounded-card border border-danger bg-danger-surface p-6">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
          <div className="min-w-0">
            <p className="font-semibold text-text">Couldn&apos;t open the broadcast</p>
            <p className="mt-1 text-body text-text">{error}</p>
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
    // v2 (live-globe Part H): the audience count is a chip on the stage, where
    // the session room shows its connection chip.
    <VideoTile
      primary
      name={tutorName}
      roleLabel="Tutor"
      avatarUrl={tutorAvatarUrl}
      track={hostVideo}
      emptyReason={hostPresent ? "camera-off" : "waiting"}
      overlay={
        <p
          className="inline-flex items-center gap-1.5 rounded-full bg-ground/70 px-3 py-1.5 text-small text-text"
          data-viewer-count={count}
        >
          <Users className="size-4" aria-hidden />
          {count} watching
        </p>
      }
    />
  );
}

/**
 * The card a viewer sees when the class is over (design overhaul Part 4). The
 * heading is the exact string E2E and the DOM test read; the ways forward are
 * a 1:1 with the same tutor, or someone else who is live.
 */
export function BroadcastEnded({ tutorName, tutorSlug }: { tutorName: string; tutorSlug?: string | null }) {
  return (
    <div className="rounded-panel bg-surface-raised p-6 md:p-8" data-broadcast-ended>
      <h2 className="font-display text-h3 font-semibold text-text">This broadcast has ended</h2>
      <p className="mt-2 max-w-prose text-body text-text-muted">
        {tutorName}&apos;s live class is over. Book a 1:1 to keep going, or see who else is teaching now.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {tutorSlug && (
          <Button asChild>
            <Link href={`/tutors/${tutorSlug}`}>Book a 1:1 with {tutorName}</Link>
          </Button>
        )}
        <Button asChild variant="outline">
          <Link href="/live">Live now</Link>
        </Button>
      </div>
    </div>
  );
}
