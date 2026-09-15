"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ConnectionState } from "agora-rtc-sdk-ng";
import { toast } from "sonner";
import { AlertTriangle, Mic, MicOff, Users, Video, VideoOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LivePill } from "@/components/ui/live-pill";
import { VideoTile, type PlayableVideoTrack } from "@/components/features/session/video-tile";
import { LiveClient, type BroadcastTokenGrant } from "@/lib/agora/live-client";
import { useBroadcastPresence } from "@/hooks/use-broadcast-presence";
import { useTokenRenewal } from "@/hooks/use-token-renewal";
import { endBroadcast, reportViewerCount } from "@/actions/broadcasts";

export interface HostStageProps {
  broadcastId: string;
  hostName: string;
  hostAvatarUrl?: string | null;
}

type Phase = "connecting" | "live" | "error";

/**
 * The tutor's host view for a live broadcast (SPEC §7.8; Phase 9 Part 3).
 *
 * Joins as the Agora host with a token the route issued for `{ broadcastId }`,
 * shows the local camera, the live viewer count from Presence, mic and camera
 * toggles, and End broadcast. The count reports only new highs to
 * `reportViewerCount`, which raises `peak_viewers` server-side.
 *
 * Closing the tab does not end the broadcast: the AppShell heartbeat stops, the
 * host drops out of `live_tutors` within two minutes (viewers stop getting
 * tokens then), and `sweep-presence` marks the row ended. End broadcast is the
 * immediate way.
 */
export function HostStage({ broadcastId, hostName, hostAvatarUrl }: HostStageProps) {
  const router = useRouter();
  const [phase, setPhase] = React.useState<Phase>("connecting");
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const [localVideo, setLocalVideo] = React.useState<PlayableVideoTrack | null>(null);
  const [connection, setConnection] = React.useState<ConnectionState | null>(null);
  const [tokenExpiresAt, setTokenExpiresAt] = React.useState<string | null>(null);
  const [micEnabled, setMicEnabled] = React.useState(true);
  const [cameraEnabled, setCameraEnabled] = React.useState(true);
  const [confirming, setConfirming] = React.useState(false);
  const [ending, setEnding] = React.useState(false);
  const clientRef = React.useRef<LiveClient | null>(null);

  const { count } = useBroadcastPresence(broadcastId, {
    onNewPeak: (n) => {
      // Display data: a failed report changes nothing the host can act on.
      reportViewerCount({ broadcastId, count: n }).catch(() => {});
    },
  });

  React.useEffect(() => {
    const client = new LiveClient({
      onLocalVideo: setLocalVideo,
      onConnectionState: setConnection,
      onError: (err) => setNotice(describeError(err)),
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
        if (!res.ok) {
          const message = (body as { error?: unknown } | null)?.error;
          setError(typeof message === "string" ? message : "Couldn't start the video.");
          setPhase("error");
          return;
        }
        const grant = body as BroadcastTokenGrant;
        if (!grant.isHost) {
          setError("Only the tutor hosting this broadcast can open this page.");
          setPhase("error");
          return;
        }
        await client.join(grant);
        if (cancelled || client.disposed) return;
        setTokenExpiresAt(grant.expiresAt);
        setPhase("live");
      } catch (err) {
        if (cancelled) return;
        setError(describeError(err));
        setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
      if (clientRef.current === client) clientRef.current = null;
      void client.leave();
    };
  }, [broadcastId, attempt]);

  const handleRenewed = React.useCallback(async (grant: BroadcastTokenGrant) => {
    try {
      await clientRef.current?.renewToken(grant.token);
      setTokenExpiresAt(grant.expiresAt);
    } catch (err) {
      setNotice(describeError(err));
    }
  }, []);

  // A refused renewal means the broadcast is no longer live (ended elsewhere, or
  // swept). The server page knows what's true.
  const handleRefused = React.useCallback(() => router.refresh(), [router]);

  useTokenRenewal<BroadcastTokenGrant>({ broadcastId }, tokenExpiresAt, handleRenewed, handleRefused);

  const end = async () => {
    setEnding(true);
    try {
      const res = await endBroadcast({ broadcastId });
      if ("error" in res) {
        toast.error(res.error);
        setEnding(false);
        return;
      }
      await clientRef.current?.leave();
      toast.success("Your broadcast has ended.");
      router.push("/tutor/broadcasts");
    } catch {
      toast.error("Couldn't end the broadcast. Try again.");
      setEnding(false);
    }
  };

  if (phase === "error") {
    return (
      <div className="rounded-lg border border-danger/30 bg-danger/10 p-6">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
          <div className="min-w-0">
            <p className="font-bold text-gray-700">Couldn&apos;t start your video</p>
            <p className="mt-1 text-body text-gray-700">{error}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  setError(null);
                  setNotice(null);
                  setLocalVideo(null);
                  setTokenExpiresAt(null);
                  setPhase("connecting");
                  setAttempt((n) => n + 1);
                }}
              >
                Try again
              </Button>
              <Button variant="secondary" loading={ending} onClick={() => void end()}>
                End broadcast
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {connection === "RECONNECTING" && (
        <p role="status" className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-small text-gray-700">
          Your connection dropped. Reconnecting…
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-700 bg-ink-900 px-4 py-3">
        <div className="flex items-center gap-3">
          {phase === "live" ? <LivePill surface="ink" /> : <span className="text-small text-ink-300">Connecting…</span>}
          <span className="inline-flex items-center gap-1.5 text-small text-white" data-viewer-count={count}>
            <Users className="size-4 text-ink-300" aria-hidden />
            {count} watching
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ink-ghost"
            size="icon"
            disabled={phase !== "live"}
            onClick={async () => {
              const next = await clientRef.current?.toggleMic();
              if (typeof next === "boolean") setMicEnabled(next);
            }}
            aria-pressed={!micEnabled}
            aria-label={micEnabled ? "Mute microphone" : "Unmute microphone"}
          >
            {micEnabled ? <Mic aria-hidden /> : <MicOff aria-hidden />}
          </Button>
          <Button
            type="button"
            variant="ink-ghost"
            size="icon"
            disabled={phase !== "live"}
            onClick={async () => {
              const next = await clientRef.current?.toggleCamera();
              if (typeof next === "boolean") setCameraEnabled(next);
            }}
            aria-pressed={!cameraEnabled}
            aria-label={cameraEnabled ? "Turn camera off" : "Turn camera on"}
          >
            {cameraEnabled ? <Video aria-hidden /> : <VideoOff aria-hidden />}
          </Button>
          {confirming ? (
            <>
              <Button type="button" variant="danger" size="sm" loading={ending} onClick={() => void end()}>
                End for everyone
              </Button>
              <Button type="button" variant="ink-ghost" size="sm" disabled={ending} onClick={() => setConfirming(false)}>
                Keep going
              </Button>
            </>
          ) : (
            <Button type="button" variant="danger" size="sm" onClick={() => setConfirming(true)}>
              End broadcast
            </Button>
          )}
        </div>
      </div>
      {notice && (
        <p role="status" aria-live="polite" className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-small text-gray-700">
          {notice}
        </p>
      )}
      <VideoTile
        primary
        name={hostName}
        roleLabel="You"
        avatarUrl={hostAvatarUrl}
        track={cameraEnabled ? localVideo : null}
        muted={!micEnabled}
        emptyReason={phase === "live" ? "camera-off" : "waiting"}
      />
    </div>
  );
}

function describeError(err: unknown): string {
  const name = (err as { name?: unknown } | null)?.name;
  const code = (err as { code?: unknown } | null)?.code;
  if (name === "NotAllowedError" || code === "PERMISSION_DENIED") {
    return "Your browser blocked the camera or microphone. Allow access and try again.";
  }
  if (code === "DEVICE_NOT_FOUND" || name === "NotFoundError") {
    return "No camera or microphone was found.";
  }
  return "Something went wrong with the video connection.";
}
