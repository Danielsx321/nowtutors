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
import { SessionTimer } from "@/components/features/session/session-timer";
import { EndSessionButton } from "@/components/features/session/end-session-button";
import { getSessionState } from "@/actions/sessions";
import { cn } from "@/lib/utils";

/**
 * The instant-session room (SPEC §7.4 in-session UI, §9).
 *
 * **Scope: connect both people, count the booked time down, and stop.** Part 3A
 * built the join; this pass adds the session timer and end-session. The mute and
 * camera toggles, screen share, text chat, credits consumed/earned and the
 * 80%-TTL token renewal are still absent rather than stubbed — an inert control
 * that looks live is worse than one that isn't there.
 *
 * **The countdown is cosmetic and this component never decides the session is
 * over.** It ticks a deadline the server computed from `bookings.started_at`,
 * and asks the server what is true at exactly three moments: on mount, when the
 * SDK reports the other party arrived (so a `started_at` written after the page
 * rendered is picked up), and once when the countdown reaches zero. Three
 * event-driven calls, no interval — CLAUDE.md's ban on polling is intact, and a
 * browser with a fast clock gets corrected rather than obeyed.
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
  /**
   * ISO-8601 hard stop, server-computed from `started_at` (§7.4). Null when the
   * pair has not completed yet — the clock has not started.
   */
  initialDeadline: string | null;
  /** Booked duration, for the timer's proportion. */
  durationMinutes: number | null;
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
  initialDeadline,
  durationMinutes,
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
  /** Server-issued. Replaced whenever the server tells us a truer one. */
  const [deadline, setDeadline] = React.useState<string | null>(initialDeadline);
  /** Terminal: the session is over and the room has been torn down. */
  const [finished, setFinished] = React.useState(false);

  /**
   * Held so the room can be torn down from outside the join effect — when the
   * session ends, the devices must be released immediately rather than at the
   * next unmount. `close()` on the local tracks is what turns the camera light
   * off, and leaving it on after a session has ended is not acceptable.
   */
  const clientRef = React.useRef<SessionClient | null>(null);

  const finish = React.useCallback(() => {
    setFinished(true);
    void clientRef.current?.leave();
  }, []);

  /**
   * Ask the server what is actually true. This is the only call this component
   * makes about session state, and it is never on a timer — see the note at the
   * top of the file for the three moments that trigger it.
   *
   * At the deadline this is also the *actor*: `getSessionState` performs the
   * transition server-side when the booked duration has run out. A failure here
   * is deliberately silent — the room stays up, the token route will refuse the
   * next credential anyway, and Part 3C's cron closes the row regardless. There
   * is nothing a person in the room could do about it.
   */
  const refreshState = React.useCallback(async () => {
    try {
      const result = await getSessionState(bookingId);
      if ("error" in result) return;
      setDeadline(result.state.deadline);
      if (result.state.finished) finish();
    } catch {
      // Intentionally ignored; see above.
    }
  }, [bookingId, finish]);

  // On mount: the page rendered from a read that may predate the other party's
  // arrival, so the deadline it handed down can already be stale.
  React.useEffect(() => {
    void refreshState();
  }, [refreshState]);

  // The other party arrived. Their join is what writes `started_at` and so what
  // creates the deadline — the SDK telling us they published is the push signal
  // that it now exists. `bookings` is not in the Realtime publication (drizzle/
  // 0006) and putting it there would be a migration, so the media layer's own
  // event is the notification, and the guarded read above is the data.
  const wasPresent = React.useRef(false);
  React.useEffect(() => {
    if (remotePresent && !wasPresent.current) void refreshState();
    wasPresent.current = remotePresent;
  }, [remotePresent, refreshState]);

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

    clientRef.current = client;
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
      if (clientRef.current === client) clientRef.current = null;
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

  // Terminal, and checked before the error branch: a token refusal that arrives
  // *because* the session ended should read as "it's over", not as a failure.
  if (finished) return <SessionEnded viewerIsTutor={viewerIsTutor} />;

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
      {/*
        The control bar. §9's mic/camera toggles and screen share belong here and
        are a separate pass — the bar carries the timer and end-session only, and
        shows nothing where those controls will go rather than showing them inert.
      */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-700 bg-ink-900 px-4 py-3">
        <SessionTimer
          deadline={deadline}
          durationMinutes={durationMinutes}
          onExpired={refreshState}
        />
        <EndSessionButton
          bookingId={bookingId}
          viewerIsTutor={viewerIsTutor}
          onEnded={finish}
        />
      </div>
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

/**
 * The room after it closes.
 *
 * Deliberately says nothing about a refund, because there isn't one: credits are
 * charged upfront and §7.4 refunds nothing on early exit or at the hard stop.
 * Copy that thanked someone vaguely and left the money unmentioned would read as
 * reassurance, and the first time a student went looking for a partial refund
 * they would find this screen had implied one.
 */
function SessionEnded({ viewerIsTutor }: { viewerIsTutor: boolean }) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900 p-6 shadow-sm">
      <h2 className="text-h3 font-bold text-white">This session has ended</h2>
      <p className="mt-2 max-w-prose text-body text-ink-300">
        The room is closed and your camera and microphone have been released.
        {viewerIsTutor
          ? " It'll show up in your bookings, and the earnings from it follow once it's been closed out."
          : " It'll show up in your bookings. The session was paid for in full when it started, so there's nothing outstanding and nothing to refund."}
      </p>
      <Button className="mt-4" variant="ink" asChild>
        <a href={viewerIsTutor ? "/tutor/bookings" : "/dashboard/bookings"}>
          Back to bookings
        </a>
      </Button>
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
