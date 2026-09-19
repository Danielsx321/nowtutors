"use client";

import * as React from "react";
import Link from "next/link";
import type { ConnectionState } from "agora-rtc-sdk-ng";
import { toast } from "sonner";
import { AlertTriangle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SessionClient, type NetworkQuality, type SessionTokenGrant } from "@/lib/agora/client";
import {
  VideoTile,
  type PlayableVideoTrack,
} from "@/components/features/session/video-tile";
import { SessionTimer, type TimeStage } from "@/components/features/session/session-timer";
import { EndSessionButton } from "@/components/features/session/end-session-button";
import { ControlBar } from "@/components/features/session/control-bar";
import { ConnectionBanner, qualityLevel } from "@/components/features/session/connection-banner";
import { PresenceChip, QualityChip } from "@/components/features/session/room-chips";
import { Lobby } from "@/components/features/session/lobby";
import { useTokenRenewal } from "@/hooks/use-token-renewal";
import { getSessionState } from "@/actions/sessions";

/**
 * The instant-session room (SPEC §7.4 in-session UI, §9).
 *
 * **Scope: connect both people, count the booked time down, and stop.** Part 3A
 * built the join; Part 3B (#34) added the session timer and end-session; this
 * pass adds the mic/camera toggles and token renewal that Part 3B carved out.
 * Screen share, text chat and credits consumed/earned are still absent rather
 * than stubbed — an inert control that looks live is worse than one that isn't
 * there. They are their own phase (DECISIONS, design overhaul Part 4).
 *
 * **Design overhaul Part 4** put a lobby in front of the join (nothing touches
 * the SDK until the person clicks Join, after a device check), the tutor's
 * video in a spotlight with the student as a small tile, a labelled control
 * bar, connection-quality warnings from the SDK's own events, and staged
 * time-left warnings. The join, renewal, end and teardown logic is unchanged.
 *
 * **Live-globe Part H** matched it to the session-room mockup: a top bar with
 * the title, a "Connected" chip and the clock pill; the connection chip on the
 * stage; a 26px stage with the student as a 16:10 picture-in-picture; and the
 * single dark control bar. Presentation only.
 *
 * **The countdown is cosmetic and this component never decides the session is
 * over.** It ticks a deadline the server computed from `bookings.started_at`,
 * and asks the server what is true at exactly four moments: on mount, when the
 * SDK reports the other party arrived (so a `started_at` written after the page
 * rendered is picked up), when the SDK reports the other party left (so an
 * end-session by either person closes both rooms), and once when the countdown
 * reaches zero. Event-driven calls, no interval — CLAUDE.md's ban on polling is intact, and a
 * browser with a fast clock gets corrected rather than obeyed.
 *
 * Everything about *what this participant publishes* comes from the token
 * response, which derives it from the booking server-side. `viewerIsTutor` below
 * is presentational only: it decides which tile is the big one and what the
 * labels read, and is never consulted for a publish decision.
 */

export interface SessionRoomProps {
  bookingId: string;
  /** The room's heading: the subject, or "Tutoring session". */
  title: string;
  /** Under the heading: who with, and for how long. */
  subtitle?: string;
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

type Phase = "lobby" | "connecting" | "joining" | "live" | "error";

interface TokenErrorBody {
  error?: unknown;
}

export function SessionRoom({
  bookingId,
  title,
  subtitle,
  viewerIsTutor,
  viewerName,
  viewerAvatarUrl,
  otherPartyName,
  otherPartyAvatarUrl,
  initialDeadline,
  durationMinutes,
}: SessionRoomProps) {
  const [phase, setPhase] = React.useState<Phase>("lobby");
  const [quality, setQuality] = React.useState<NetworkQuality | null>(null);
  const [stage, setStage] = React.useState<TimeStage>("normal");
  const [layout, setLayout] = React.useState<"spotlight" | "side-by-side">("spotlight");
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
  /** The current token's server-reported expiry (§9 step 5). Drives renewal below. */
  const [tokenExpiresAt, setTokenExpiresAt] = React.useState<string | null>(null);
  const [micEnabled, setMicEnabled] = React.useState(true);
  /** Null for a student: no camera track exists to toggle (§9, media split). */
  const [cameraEnabled, setCameraEnabled] = React.useState<boolean | null>(
    viewerIsTutor ? true : null,
  );

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
   * top of the file for the four moments that trigger it.
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

  // Read by the SDK handlers below, which are bound once per join and so can't
  // close over a newer `refreshState`.
  const refreshRef = React.useRef(refreshState);
  refreshRef.current = refreshState;

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

  const inLobby = phase === "lobby";
  React.useEffect(() => {
    // Nothing joins, and no device is asked for, until the lobby's Join.
    if (inLobby) return;
    // Constructed synchronously so the cleanup below can always dispose it —
    // including while the join is still awaiting device permission, which is
    // exactly when an abandoned camera gets stranded.
    const client = new SessionClient({
      onLocalVideo: setLocalVideo,
      onRemoteVideo: setRemoteVideo,
      onRemotePresence: (present) => {
        setRemotePresent(present);
        // The other person left the channel. If they ended the session, the
        // server has already closed it and this is how this side finds out:
        // without it the room stayed open, timer running, until the booked
        // time ran out. A dropped connection gets "not finished" back and the
        // room simply waits for them. Event-driven, one call per departure.
        if (!present) void refreshRef.current();
      },
      onConnectionState: setConnection,
      onNetworkQuality: setQuality,
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

        const grant = body as SessionTokenGrant;
        setPhase("joining");
        await client.join(grant);
        if (cancelled || client.disposed) return;
        setTokenExpiresAt(grant.expiresAt);
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
    // through this cleanup and builds a fresh one. `inLobby` flipping to false
    // is the first join. `phase` itself is deliberately not a dependency: the
    // effect sets it, and re-running on every phase change would rejoin.
  }, [bookingId, attempt, inLobby]);

  const retry = () => {
    setError(null);
    setNotice(null);
    setLocalVideo(null);
    setRemoteVideo(null);
    setRemotePresent(false);
    setTokenExpiresAt(null);
    setQuality(null);
    setPhase("connecting");
    setAttempt((n) => n + 1);
  };

  const onStageChange = React.useCallback((next: TimeStage) => {
    setStage(next);
    if (next === "five") toast("5 minutes left in this session.");
  }, []);

  /**
   * Swap the renewed token in without dropping the connection (§9 step 6),
   * then re-arm this hook off the fresh `expiresAt` it came back with.
   */
  const handleRenewed = React.useCallback(async (grant: SessionTokenGrant) => {
    try {
      await clientRef.current?.renewToken(grant.token);
      setTokenExpiresAt(grant.expiresAt);
    } catch (err) {
      setNotice(describeJoinError(err));
    }
  }, []);

  /**
   * The renewal request came back non-OK. It re-ran the same checks the
   * initial join did (participation, and the elapsed refusal Part 3B added),
   * so the server has already spoken — ask it what is now true rather than
   * guess. If the booking elapsed mid-session, `refreshState` is what turns
   * that into `finish()`; the best-effort deadline transition on the route's
   * refusal applies unchanged and needs nothing from the client.
   */
  const handleRenewalRefused = React.useCallback(() => {
    void refreshState();
  }, [refreshState]);

  useTokenRenewal({ bookingId }, tokenExpiresAt, handleRenewed, handleRenewalRefused);

  const toggleMic = React.useCallback(async () => {
    const next = await clientRef.current?.toggleMic();
    if (next !== undefined) setMicEnabled(next);
  }, []);

  const toggleCamera = React.useCallback(async () => {
    const next = await clientRef.current?.toggleCamera();
    // `undefined` means no client yet; `null` means no camera track (student)
    // and is a legitimate result, not "unknown" — both leave state alone only
    // in the first case.
    if (next !== undefined) setCameraEnabled(next);
  }, []);

  // Terminal, and checked before the error branch: a token refusal that arrives
  // *because* the session ended should read as "it's over", not as a failure.
  const topBar = (status?: React.ReactNode) => (
    <RoomTopBar title={title} subtitle={subtitle}>
      {status}
    </RoomTopBar>
  );

  if (finished) {
    return (
      <div className="flex flex-col gap-4">
        {topBar()}
        <SessionEnded
          viewerIsTutor={viewerIsTutor}
          otherPartyName={otherPartyName}
          durationMinutes={durationMinutes}
        />
      </div>
    );
  }

  if (phase === "lobby") {
    return (
      <div className="flex flex-col gap-4">
        {topBar()}
        <Lobby
          needsCamera={viewerIsTutor}
          otherPartyName={otherPartyName}
          otherPartyAvatarUrl={otherPartyAvatarUrl}
          onJoin={() => setPhase("connecting")}
        />
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex flex-col gap-4">
        {topBar()}
        <div role="alert" className="rounded-card border border-danger bg-danger-surface p-6">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
            <div className="min-w-0">
              <p className="font-semibold text-text">Couldn&apos;t join the session</p>
              <p className="mt-1 text-body text-text">{error}</p>
              <Button className="mt-4" onClick={retry}>
                Try again
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // The tutor's camera is the main tile for both parties: it is the only video in
  // the room (the student publishes microphone only, §9).
  // The chip on the stage reports this browser's own link, the one the person
  // can do something about. Problems are also spelled out in the banner above;
  // the chip is the at-a-glance version, so it says nothing until the SDK has
  // reported a quality.
  const stageChip =
    phase === "live" && quality ? (
      <QualityChip level={qualityLevel(Math.max(quality.uplink, quality.downlink))} />
    ) : null;

  const tutorTile = viewerIsTutor ? (
    <VideoTile
      primary
      overlay={stageChip}
      name={viewerName}
      roleLabel="You"
      avatarUrl={viewerAvatarUrl}
      // A toggled-off camera renders the same "Camera off" placeholder as one
      // that never came up, rather than a frozen last frame — `setEnabled`
      // stops sending, it does not stop this component from being handed a
      // still-live track object.
      track={cameraEnabled === false ? null : localVideo}
      muted={!micEnabled}
      emptyReason={phase === "live" ? "camera-off" : "waiting"}
    />
  ) : (
    <VideoTile
      primary
      overlay={stageChip}
      name={otherPartyName}
      roleLabel="Tutor"
      avatarUrl={otherPartyAvatarUrl}
      track={remoteVideo}
      emptyReason={remotePresent ? "camera-off" : "waiting"}
    />
  );

  // The student never publishes video, so their tile is an audio-only card
  // rather than an empty frame waiting for a picture that is not coming.
  const spotlight = layout === "spotlight";
  const studentTile = viewerIsTutor ? (
    <VideoTile
      compact={spotlight}
      name={otherPartyName}
      roleLabel="Student"
      avatarUrl={otherPartyAvatarUrl}
      track={null}
      emptyReason={remotePresent ? "audio-only" : "waiting"}
    />
  ) : (
    <VideoTile
      compact={spotlight}
      name={viewerName}
      roleLabel="You"
      avatarUrl={viewerAvatarUrl}
      track={null}
      muted={!micEnabled}
      emptyReason={phase === "live" ? "audio-only" : "waiting"}
    />
  );

  const cameraOn = cameraEnabled === true;

  return (
    <div className="flex flex-col gap-4">
      {topBar(
        <>
          {phase === "live" && (
            <PresenceChip present={remotePresent} otherPartyName={otherPartyName} />
          )}
          <div className="sm:ml-auto">
            <SessionTimer
              deadline={deadline}
              durationMinutes={durationMinutes}
              onExpired={refreshState}
              onStageChange={onStageChange}
            />
          </div>
        </>,
      )}

      <ConnectionBanner
        phase={phase}
        connection={connection}
        quality={phase === "live" ? quality : null}
        otherRole={viewerIsTutor ? "Your student" : "Your tutor"}
        onTurnOffVideo={viewerIsTutor && cameraOn ? () => void toggleCamera() : undefined}
        onRejoin={retry}
      />

      {(stage === "two" || stage === "final") && (
        <p className="flex items-center gap-2 rounded-[14px] border border-warning bg-warning-surface px-3 py-2 text-small text-warning">
          <Clock className="size-4 shrink-0" aria-hidden />
          {stage === "final"
            ? "Less than a minute left. The room closes on time."
            : "2 minutes left. The session ends on time and can't be extended."}
        </p>
      )}

      {notice && (
        <p
          role="status"
          aria-live="polite"
          className="rounded-[14px] border border-warning bg-warning-surface px-3 py-2 text-small text-warning"
        >
          {notice}
        </p>
      )}

      {spotlight ? (
        // Below md the picture-in-picture would cover most of a phone-width
        // stage, so it sits under it instead.
        <div className="space-y-3 md:relative md:space-y-0">
          {tutorTile}
          <div className="w-40 md:absolute md:bottom-[18px] md:right-[18px] md:w-[clamp(150px,20vw,240px)]">
            {studentTile}
          </div>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
          {tutorTile}
          {studentTile}
        </div>
      )}

      <ControlBar
        micEnabled={micEnabled}
        cameraEnabled={cameraEnabled}
        disabled={phase !== "live"}
        onToggleMic={() => void toggleMic()}
        onToggleCamera={() => void toggleCamera()}
        layout={layout}
        onToggleLayout={() => setLayout((l) => (l === "spotlight" ? "side-by-side" : "spotlight"))}
        endAction={
          <EndSessionButton bookingId={bookingId} viewerIsTutor={viewerIsTutor} onEnded={finish} />
        }
      />
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
 *
 * There is no Rejoin here: this screen only renders once the server has closed
 * the session, and a closed session has no room to go back to. A rating ask
 * belongs under the summary once reviews exist (after launch, §18); until then
 * nothing renders in that slot.
 */
function SessionEnded({
  viewerIsTutor,
  otherPartyName,
  durationMinutes,
}: {
  viewerIsTutor: boolean;
  otherPartyName: string;
  durationMinutes: number | null;
}) {
  const bookings = viewerIsTutor ? "/tutor/bookings" : "/dashboard/bookings";
  return (
    <section
      aria-labelledby="ended-title"
      className="mx-auto w-full max-w-xl space-y-4 rounded-panel bg-surface-raised p-6 text-center md:p-8"
    >
      <h2 id="ended-title" className="font-display text-h2 font-semibold text-text">
        Session ended
      </h2>
      <p className="text-body text-text">
        {durationMinutes ? `Your ${durationMinutes}-minute session` : "Your session"} with {otherPartyName} is over.
      </p>
      <p className="mx-auto max-w-prose text-small text-text-muted">
        Your camera and microphone have been released.
        {viewerIsTutor
          ? " It'll show up in your bookings, and the earnings from it follow once it's been closed out."
          : " It'll show up in your bookings. The session was paid for in full when it started, so there's nothing outstanding and nothing to refund."}
      </p>
      <div className="flex flex-wrap justify-center gap-2 pt-2">
        <Button asChild>
          <Link href={bookings}>Back to bookings</Link>
        </Button>
        {!viewerIsTutor && (
          <Button asChild variant="outline">
            <Link href="/tutors?live=1">Find a live tutor</Link>
          </Button>
        )}
      </div>
      <p className="text-small text-text-muted">
        Something went wrong?{" "}
        <Link href={bookings} className="focus-ring rounded-sm font-medium text-accent hover:underline">
          Find the session in your bookings
        </Link>
        .
      </p>
    </section>
  );
}

/**
 * The room's top bar (session-room mockup): the heading on the left, and the
 * presence chip and clock pill passed in as children.
 */
function RoomTopBar({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="font-display text-h3 font-semibold text-text">{title}</h1>
        {subtitle && <p className="text-small text-text-muted">{subtitle}</p>}
      </div>
      {children}
    </header>
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
