"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Clock, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  VideoTile,
} from "@/components/features/session/video-tile";
import { SessionTimer } from "@/components/features/session/session-timer";
import { EndSessionButton } from "@/components/features/session/end-session-button";
import { ControlBar } from "@/components/features/session/control-bar";
import { ConnectionBanner, qualityLevel } from "@/components/features/session/connection-banner";
import { PresenceChip, QualityChip } from "@/components/features/session/room-chips";
import { Lobby } from "@/components/features/session/lobby";
import { useActiveSession, type SessionMeta } from "@/components/features/session/active-session";
import { INSTANT_UNMET_GRACE_MINUTES } from "@/lib/sessions/deadline";

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
 * **Mini-player (2026-09-29):** the call itself (join, renewal, the server
 * reads, mic and camera) moved to `ActiveSessionProvider` in the root
 * providers, so it survives leaving this page; off this page the mini-player
 * shows it. This component is now the full-size view of that call, plus the
 * lobby that starts it. Coming back through Enlarge finds the call already
 * held and skips the lobby. The countdown is drawn here but no longer acts:
 * the provider's timeout calls the server at the deadline.
 *
 * Everything about *what this participant publishes* comes from the token
 * response, which derives it from the booking server-side. `viewerIsTutor` below
 * is presentational only: it decides which tile is the big one and what the
 * labels read, and is never consulted for a publish decision.
 */

/** Same props the page always passed; they become the provider's `SessionMeta` on Join. */
export type SessionRoomProps = SessionMeta;

export function SessionRoom(props: SessionRoomProps) {
  const {
    bookingId,
    title,
    subtitle,
    viewerIsTutor,
    viewerName,
    viewerAvatarUrl,
    otherPartyName,
    otherPartyAvatarUrl,
    durationMinutes,
  } = props;
  const session = useActiveSession();
  const [layout, setLayout] = React.useState<"spotlight" | "side-by-side">("spotlight");

  const mine = session.meta?.bookingId === bookingId;
  const other = session.meta && !mine && session.phase !== "idle" ? session.meta : null;

  const topBar = (status?: React.ReactNode) => (
    <RoomTopBar title={title} subtitle={subtitle}>
      {status}
    </RoomTopBar>
  );

  // Another booking's call is held in this tab (one at a time, see the provider).
  if (other) {
    return (
      <div className="flex flex-col gap-4">
        {topBar()}
        <div className="rounded-card bg-surface-raised p-6">
          <h2 className="text-h3 font-bold text-text">You&apos;re already in a session</h2>
          <p className="mt-2 max-w-prose text-body text-text-muted">
            Your session with {other.otherPartyName} is still running. Finish it before joining this one.
          </p>
          <Button asChild className="mt-4">
            <Link href={`/session/${other.bookingId}`}>
              <Maximize2 aria-hidden />
              Back to that session
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  // Terminal, and checked before the error branch: a token refusal that arrives
  // *because* the session ended should read as "it's over", not as a failure.
  if (mine && session.finished) {
    return (
      <div className="flex flex-col gap-4">
        {topBar()}
        <SessionEnded
          viewerIsTutor={viewerIsTutor}
          otherPartyName={otherPartyName}
          durationMinutes={durationMinutes}
          status={session.endedStatus}
        />
      </div>
    );
  }

  if (session.signingOut) {
    return (
      <div className="flex flex-col gap-4">
        {topBar()}
        <p role="status" className="text-body text-text-muted">
          Signing you out…
        </p>
      </div>
    );
  }

  if (!mine || session.phase === "idle") {
    return (
      <div className="flex flex-col gap-4">
        {topBar()}
        <Lobby
          needsCamera={viewerIsTutor}
          otherPartyName={otherPartyName}
          otherPartyAvatarUrl={otherPartyAvatarUrl}
          onJoin={() => session.start(props)}
        />
      </div>
    );
  }

  const { phase, quality, remotePresent, micEnabled, cameraEnabled, localVideo, remoteVideo } = session;

  if (phase === "error") {
    return (
      <div className="flex flex-col gap-4">
        {topBar()}
        <div role="alert" className="rounded-card border border-danger bg-danger-surface p-6">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
            <div className="min-w-0">
              <p className="font-semibold text-text">Couldn&apos;t join the session</p>
              <p className="mt-1 text-body text-text">{session.error}</p>
              <Button className="mt-4" onClick={session.retry}>
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
      // that never came up, rather than a frozen last frame.
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
  const stage = session.stage;

  return (
    <div className="flex flex-col gap-4">
      {topBar(
        <>
          {phase === "live" && (
            <PresenceChip present={remotePresent} otherPartyName={otherPartyName} />
          )}
          <div className="sm:ml-auto">
            <SessionTimer
              deadline={session.deadline}
              durationMinutes={durationMinutes}
              onStageChange={session.reportStage}
            />
          </div>
        </>,
      )}

      <ConnectionBanner
        phase={phase}
        connection={session.connection}
        quality={phase === "live" ? quality : null}
        otherRole={viewerIsTutor ? "Your student" : "Your tutor"}
        onTurnOffVideo={viewerIsTutor && cameraOn ? () => void session.toggleCamera() : undefined}
        onRejoin={session.retry}
      />

      {(stage === "two" || stage === "final") && (
        <p className="flex items-center gap-2 rounded-[14px] border border-warning bg-warning-surface px-3 py-2 text-small text-warning">
          <Clock className="size-4 shrink-0" aria-hidden />
          {stage === "final"
            ? "Less than a minute left. The room closes on time."
            : "2 minutes left. The session ends on time and can't be extended."}
        </p>
      )}

      {session.notice && (
        <p
          role="status"
          aria-live="polite"
          className="rounded-[14px] border border-warning bg-warning-surface px-3 py-2 text-small text-warning"
        >
          {session.notice}
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
        onToggleMic={() => void session.toggleMic()}
        onToggleCamera={() => void session.toggleCamera()}
        layout={layout}
        onToggleLayout={() => setLayout((l) => (l === "spotlight" ? "side-by-side" : "spotlight"))}
        endAction={
          <EndSessionButton bookingId={bookingId} viewerIsTutor={viewerIsTutor} onEnded={session.finish} />
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
  status,
}: {
  viewerIsTutor: boolean;
  otherPartyName: string;
  durationMinutes: number | null;
  /** The server's closing status; `no_show_*` gets its own wording. */
  status: string | null;
}) {
  const bookings = viewerIsTutor ? "/tutor/bookings" : "/dashboard/bookings";

  // The pair never met and the grace ran out (§12). Say so, and say what it
  // means for the money in the refunds page's own words, rather than the
  // generic "is over" line, which would be untrue.
  if (status === "no_show_student" || status === "no_show_tutor") {
    const otherMissing =
      (status === "no_show_student" && viewerIsTutor) || (status === "no_show_tutor" && !viewerIsTutor);
    return (
      <section
        aria-labelledby="ended-title"
        className="mx-auto w-full max-w-xl space-y-4 rounded-panel bg-surface-raised p-6 text-center md:p-8"
      >
        <h2 id="ended-title" className="font-display text-h2 font-semibold text-text">
          {otherMissing ? `${otherPartyName} didn\u2019t join` : "This session was closed"}
        </h2>
        <p className="text-body text-text">
          {otherMissing
            ? `Nobody arrived within ${INSTANT_UNMET_GRACE_MINUTES} minutes, so the session was closed.`
            : `The session was closed after ${INSTANT_UNMET_GRACE_MINUTES} minutes because you hadn\u2019t joined.`}
        </p>
        <p className="mx-auto max-w-prose text-small text-text-muted">
          Your camera and microphone have been released.
          {status === "no_show_tutor"
            ? viewerIsTutor
              ? " No earnings are recorded for it."
              : " Your credits come back: contact us and the team returns them to your wallet, and you can book again straight away."
            : viewerIsTutor
              ? " The session counts as taken, so your earnings from it follow once it\u2019s been closed out."
              : " The session counts as taken. It was paid for in full when it was accepted, and the credits aren\u2019t returned."}
        </p>
        <div className="flex flex-wrap justify-center gap-2 pt-2">
          <Button asChild>
            <Link href={bookings}>Back to bookings</Link>
          </Button>
        </div>
      </section>
    );
  }

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
