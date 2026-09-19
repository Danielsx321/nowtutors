"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ConnectionState } from "agora-rtc-sdk-ng";
import { toast } from "sonner";
import { AlertTriangle, Clock, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LiveChip } from "@/components/ui/live-chip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ControlBar } from "@/components/features/session/control-bar";
import { VideoTile, type PlayableVideoTrack } from "@/components/features/session/video-tile";
import { LiveClient, type BroadcastTokenGrant } from "@/lib/agora/live-client";
import { useBroadcastPresence } from "@/hooks/use-broadcast-presence";
import { useTokenRenewal } from "@/hooks/use-token-renewal";
import { endBroadcast, reportViewerCount } from "@/actions/broadcasts";

export interface HostStageProps {
  broadcastId: string;
  hostName: string;
  hostAvatarUrl?: string | null;
  /** ISO-8601, when the broadcast went live: the status bar's elapsed clock. */
  startedAt?: string | null;
}

/**
 * Time on air, `m:ss` or `h:mm:ss`. A cosmetic once-a-second tick with no
 * network call, the same kind as the request ring (not the polling CLAUDE.md
 * forbids).
 */
function Elapsed({ since }: { since: string }) {
  const start = React.useMemo(() => new Date(since).getTime(), [since]);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((now - start) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  const text = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
  return (
    <span data-numeric className="inline-flex items-center gap-1.5 text-small text-text" aria-label={`On air for ${text}`}>
      <Clock className="size-4 text-text-muted" aria-hidden />
      {text}
    </span>
  );
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
export function HostStage({ broadcastId, hostName, hostAvatarUrl, startedAt }: HostStageProps) {
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
      <div role="alert" className="rounded-xl border border-danger bg-danger-surface p-6">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
          <div className="min-w-0">
            <p className="font-semibold text-text">Couldn&apos;t start your video</p>
            <p className="mt-1 text-body text-text">{error}</p>
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
              <Button variant="outline" loading={ending} onClick={() => void end()}>
                End broadcast
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const reconnecting = connection === "RECONNECTING" || connection === "CONNECTING";

  return (
    <div className="flex flex-col gap-3">
      {/* Status bar (design overhaul Part 4): on air, for how long, to how many, and the line. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-surface-raised px-4 py-2.5">
        {phase === "live" ? (
          <LiveChip label="LIVE" />
        ) : (
          <span className="inline-flex items-center gap-2 text-small text-text-muted">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
            Connecting…
          </span>
        )}
        {phase === "live" && startedAt && <Elapsed since={startedAt} />}
        <span className="inline-flex items-center gap-1.5 text-small text-text" data-viewer-count={count}>
          <Users className="size-4 text-text-muted" aria-hidden />
          {count} watching
        </span>
        <span role="status" aria-live="polite" className={reconnecting ? "text-small text-warning" : "sr-only"}>
          {reconnecting ? "Your connection dropped. Reconnecting…" : phase === "live" ? "Connected" : ""}
        </span>
      </div>

      {notice && (
        <p role="status" aria-live="polite" className="rounded-lg border border-warning bg-warning-surface px-3 py-2 text-small text-warning">
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

      <ControlBar
        micEnabled={micEnabled}
        cameraEnabled={cameraEnabled}
        disabled={phase !== "live"}
        onToggleMic={async () => {
          const next = await clientRef.current?.toggleMic();
          if (typeof next === "boolean") setMicEnabled(next);
        }}
        onToggleCamera={async () => {
          const next = await clientRef.current?.toggleCamera();
          if (typeof next === "boolean") setCameraEnabled(next);
        }}
        endAction={
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="danger" loading={ending}>
                End broadcast
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="theme-dark">
              <AlertDialogHeader>
                <AlertDialogTitle>End this broadcast?</AlertDialogTitle>
                <AlertDialogDescription>
                  {count === 1
                    ? "1 person is watching. They'll see that the class has ended."
                    : `${count} people are watching. They'll see that the class has ended.`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep going</AlertDialogCancel>
                <AlertDialogAction variant="danger" onClick={() => void end()}>
                  End for everyone
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        }
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
