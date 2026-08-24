"use client";

import * as React from "react";
import type { ConnectionState } from "agora-rtc-sdk-ng";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SessionClient, type SessionTokenGrant } from "@/lib/agora/client";
import {
  VideoTile,
  type PlayableVideoTrack,
} from "@/components/features/session/video-tile";
import { cn } from "@/lib/utils";

/**
 * The instant-session room (SPEC §7.4 in-session UI, §9).
 *
 * **Part 3A scope: get both people connected and get out cleanly.** The elapsed
 * timer, credits consumed/earned, mute and camera toggles, screen share, text
 * chat and end-session are Part 3B, and are deliberately absent rather than
 * stubbed — an inert control that looks live is worse than one that isn't there.
 *
 * Everything about *what this participant publishes* comes from the token
 * response, which derives it from the booking server-side. `viewerIsTutor` below
 * is presentational only: it decides which tile is the big one and what the
 * labels read, and is never consulted for a publish decision.
 */

export interface SessionRoomProps {
  bookingId: string;
  /** Labels and layout only — the publish decision comes from the token route. */
  viewerIsTutor: boolean;
  viewerName: string;
  viewerAvatarUrl?: string | null;
  otherPartyName: string;
  otherPartyAvatarUrl?: string | null;
}

type Phase = "connecting" | "joining" | "live" | "error";

interface TokenErrorBody {
  error?: unknown;
}

export function SessionRoom({
  bookingId,
  viewerIsTutor,
  viewerName,
  viewerAvatarUrl,
  otherPartyName,
  otherPartyAvatarUrl,
}: SessionRoomProps) {
  const [phase, setPhase] = React.useState<Phase>("connecting");
  const [error, setError] = React.useState<string | null>(null);
  /** A failure AFTER a successful join. Worth saying, not worth tearing the room down for. */
  const [notice, setNotice] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const [localVideo, setLocalVideo] = React.useState<PlayableVideoTrack | null>(null);
  const [remoteVideo, setRemoteVideo] = React.useState<PlayableVideoTrack | null>(null);
  const [remotePresent, setRemotePresent] = React.useState(false);
  const [connection, setConnection] = React.useState<ConnectionState | null>(null);

  React.useEffect(() => {
    // Constructed synchronously so the cleanup below can always dispose it —
    // including while the join is still awaiting device permission, which is
    // exactly when an abandoned camera gets stranded.
    const client = new SessionClient({
      onLocalVideo: setLocalVideo,
      onRemoteVideo: setRemoteVideo,
      onRemotePresence: setRemotePresent,
      onConnectionState: setConnection,
      onError: (err) => setNotice(describeJoinError(err)),
    });

    let cancelled = false;

    void (async () => {
      try {
        // The client sends a booking id and nothing else. Channel, role, uid and
        // identity are all decided by the route (CLAUDE.md: tokens are never
        // issued client-side, and the Render service is never called from here).
        const res = await fetch("/api/agora/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookingId }),
          cache: "no-store",
        });
        const body: unknown = await res.json().catch(() => null);

        if (!res.ok) {
          if (cancelled) return;
          const message = (body as TokenErrorBody | null)?.error;
          setError(
            typeof message === "string"
              ? message
              : "Couldn't connect to this session.",
          );
          setPhase("error");
          return;
        }
        if (cancelled || client.disposed) return;

        setPhase("joining");
        await client.join(body as SessionTokenGrant);
        if (cancelled || client.disposed) return;
        setPhase("live");
      } catch (err) {
        if (cancelled) return;
        setError(describeJoinError(err));
        setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
      // Stops tracks, closes devices, leaves the channel. Safe mid-join.
      void client.leave();
    };
    // `attempt` is the retry trigger: bumping it tears the old client down
    // through this cleanup and builds a fresh one.
  }, [bookingId, attempt]);

  const retry = () => {
    setError(null);
    setNotice(null);
    setLocalVideo(null);
    setRemoteVideo(null);
    setRemotePresent(false);
    setPhase("connecting");
    setAttempt((n) => n + 1);
  };

  if (phase === "error") {
    return (
      <div className="rounded-lg border border-danger/30 bg-danger/10 p-6">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
          <div className="min-w-0">
            <p className="font-bold text-gray-700">Couldn&apos;t join the session</p>
            <p className="mt-1 text-body text-gray-700">{error}</p>
            <Button className="mt-4" onClick={retry}>
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // The tutor's camera is the main tile for both parties: it is the only video in
  // the room (the student publishes microphone only, §9).
  const tutorTile = viewerIsTutor ? (
    <VideoTile
      primary
      name={viewerName}
      roleLabel="You"
      avatarUrl={viewerAvatarUrl}
      track={localVideo}
      emptyReason={phase === "live" ? "camera-off" : "waiting"}
    />
  ) : (
    <VideoTile
      primary
      name={otherPartyName}
      roleLabel="Tutor"
      avatarUrl={otherPartyAvatarUrl}
      track={remoteVideo}
      emptyReason={remotePresent ? "camera-off" : "waiting"}
    />
  );

  // The student never publishes video, so their tile is an audio-only card
  // rather than an empty frame waiting for a picture that is not coming.
  const studentTile = viewerIsTutor ? (
    <VideoTile
      name={otherPartyName}
      roleLabel="Student"
      avatarUrl={otherPartyAvatarUrl}
      track={null}
      emptyReason={remotePresent ? "audio-only" : "waiting"}
    />
  ) : (
    <VideoTile
      name={viewerName}
      roleLabel="You"
      avatarUrl={viewerAvatarUrl}
      track={null}
      emptyReason={phase === "live" ? "audio-only" : "waiting"}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <ConnectionBanner phase={phase} connection={connection} />
      {notice && (
        <p
          role="status"
          aria-live="polite"
          className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-small text-gray-700"
        >
          {notice}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        {tutorTile}
        {studentTile}
      </div>
    </div>
  );
}

function ConnectionBanner({
  phase,
  connection,
}: {
  phase: Phase;
  connection: ConnectionState | null;
}) {
  const reconnecting = connection === "RECONNECTING" || connection === "CONNECTING";
  const label =
    phase === "connecting"
      ? "Connecting to the session…"
      : phase === "joining"
        ? "Joining — allow microphone access when your browser asks."
        : reconnecting
          ? "Reconnecting…"
          : "Connected";
  const settled = phase === "live" && !reconnecting;

  return (
    <div
      // The status changes without a user action, so it is announced (§10.3).
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-2 rounded-md border px-3 py-2 text-small",
        settled
          ? "border-gray-200 bg-gray-50 text-gray-700"
          : "border-warning/30 bg-warning/10 text-gray-700",
      )}
    >
      {settled ? (
        <span
          className="size-2 shrink-0 rounded-full bg-live-500"
          aria-hidden
        />
      ) : (
        <Loader2 className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
      )}
      {label}
    </div>
  );
}

/**
 * Turn an SDK or network failure into something the person in the room can act
 * on. Agora's own messages name internal codes; "PERMISSION_DENIED" is not an
 * instruction to anyone.
 */
function describeJoinError(err: unknown): string {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code: unknown }).code)
      : "";

  switch (code) {
    case "PERMISSION_DENIED":
      return "Your browser blocked access to the microphone or camera. Allow it in the address bar, then try again.";
    case "DEVICE_NOT_FOUND":
      return "No microphone was found. Connect one and try again.";
    case "NOT_READABLE":
    case "NOT_SUPPORTED":
      return "Another app is using your microphone or camera. Close it and try again.";
    default:
      return "Something went wrong connecting to the session. Please try again.";
  }
}
