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
import { Thread } from "@/components/features/messaging/thread";
import { INSTANT_UNMET_GRACE_MINUTES } from "@/lib/sessions/deadline";
import type { SessionChat } from "@/lib/messaging/session-chat-types";
import { cn } from "@/lib/utils";

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
 * **Room features (2026-09-30):** both people publish a camera (a student
 * without one joins with audio only), either can share a screen (the sharer's
 * picture takes the spotlight, letterboxed and tagged), and the pair's
 * conversation from Messages sits beside the stage as a chat panel, opened by
 * the Chat button. The three were parked on 16 Sep so the video could be tested
 * with two real people first (DECISIONS, design overhaul Part 4).
 *
 * Everything about *what this participant publishes* comes from the token
 * response, which derives it from the booking server-side. `viewerIsTutor` below
 * is presentational only: it decides which tile is the big one and what the
 * labels read, and is never consulted for a publish decision.
 */

/** Same props the page always passed; they become the provider's `SessionMeta` on Join. */
export type SessionRoomProps = SessionMeta & {
  /** The pair's thread for the chat panel; null hides the panel and its button. */
  chat?: SessionChat | null;
};

export function SessionRoom(props: SessionRoomProps) {
  const {
    chat,
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
  const [chatOpen, setChatOpen] = React.useState(false);
  const [chatUnread, setChatUnread] = React.useState(0);

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
          needsCamera
          cameraOptional={!viewerIsTutor}
          otherPartyName={otherPartyName}
          otherPartyAvatarUrl={otherPartyAvatarUrl}
          onJoin={() => session.start(props)}
        />
      </div>
    );
  }

  const {
    phase,
    quality,
    remotePresent,
    remoteSharing,
    micEnabled,
    cameraEnabled,
    localVideo,
    localScreen,
    remoteVideo,
    sharing,
    canShareScreen,
  } = session;

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

  // The chip on the stage reports this browser's own link, the one the person
  // can do something about. Problems are also spelled out in the banner above;
  // the chip is the at-a-glance version, so it says nothing until the SDK has
  // reported a quality.
  const stageChip =
    phase === "live" && quality ? (
      <QualityChip level={qualityLevel(Math.max(quality.uplink, quality.downlink))} />
    ) : null;

  // Both people publish a camera (2026-09-30). Your own tile draws the local
  // track (the screen while you share it); the other person's draws whatever
  // they publish, with the room signal saying whether it is their screen.
  const ownVideo = localScreen ?? (cameraEnabled === false ? null : localVideo);
  const ownEmpty: "audio-only" | "waiting" | "camera-off" =
    phase !== "live" ? "waiting" : cameraEnabled === null ? "audio-only" : "camera-off";
  const otherEmpty: "audio-only" | "waiting" | "camera-off" = remotePresent ? "camera-off" : "waiting";

  // The tutor is the spotlight by default; whoever shares a screen takes it.
  const spotlightIsMe = sharing ? true : remoteSharing ? false : viewerIsTutor;

  const tileFor = (me: boolean, primary: boolean, compact: boolean) =>
    me ? (
      <VideoTile
        primary={primary}
        compact={compact}
        overlay={primary ? stageChip : undefined}
        name={viewerName}
        roleLabel="You"
        avatarUrl={viewerAvatarUrl}
        track={ownVideo}
        fit={localScreen ? "contain" : "cover"}
        badge={localScreen ? "Sharing your screen" : undefined}
        muted={!micEnabled}
        emptyReason={ownEmpty}
      />
    ) : (
      <VideoTile
        primary={primary}
        compact={compact}
        overlay={primary ? stageChip : undefined}
        name={otherPartyName}
        roleLabel={viewerIsTutor ? "Student" : "Tutor"}
        avatarUrl={otherPartyAvatarUrl}
        track={remoteVideo}
        fit={remoteSharing ? "contain" : "cover"}
        badge={remoteSharing ? "Sharing screen" : undefined}
        emptyReason={otherEmpty}
      />
    );

  const spotlight = layout === "spotlight";
  const mainTile = tileFor(spotlightIsMe, true, false);
  const sideTile = tileFor(!spotlightIsMe, false, spotlight);

  const cameraOn = cameraEnabled === true;
  const stage = session.stage;
  const showChat = chat != null && chatOpen;

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
        onTurnOffVideo={cameraOn ? () => void session.toggleCamera() : undefined}
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

      <div className={cn("grid gap-4", showChat && "lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]")}>
        {spotlight ? (
          // Below md the picture-in-picture would cover most of a phone-width
          // stage, so it sits under it instead.
          <div className="space-y-3 md:relative md:space-y-0">
            {mainTile}
            <div className="w-40 md:absolute md:bottom-[18px] md:right-[18px] md:w-[clamp(150px,20vw,240px)]">
              {sideTile}
            </div>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
            {mainTile}
            {sideTile}
          </div>
        )}

        {chat && (
          // Mounted while the room is live whether or not it is open, so the
          // thread's Realtime channel keeps counting what arrives behind a
          // closed panel. Hidden with `hidden`, not unmounted.
          <aside
            aria-label="Session chat"
            className={cn(
              "flex flex-col rounded-panel bg-surface-raised p-3 md:p-4",
              !showChat && "hidden",
            )}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-small font-semibold text-text">Chat with {otherPartyName}</h2>
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                className="focus-ring rounded-sm text-small text-text-muted hover:text-text"
              >
                Close
              </button>
            </div>
            <Thread
              conversationId={chat.conversationId}
              viewerId={chat.viewerId}
              initialMessages={chat.initialMessages}
              initialHasOlder={chat.initialHasOlder}
              className="flex h-[360px] min-h-0 flex-col lg:h-[calc(100%-2rem)] lg:min-h-[420px]"
              onIncoming={() => {
                if (!chatOpen) setChatUnread((n) => n + 1);
              }}
            />
            <p className="mt-2 text-caption text-text-muted">
              Saved to your Messages, so you can both find it after the session.
            </p>
          </aside>
        )}
      </div>

      <ControlBar
        micEnabled={micEnabled}
        cameraEnabled={cameraEnabled}
        disabled={phase !== "live"}
        onToggleMic={() => void session.toggleMic()}
        onToggleCamera={() => void session.toggleCamera()}
        sharing={canShareScreen ? sharing : undefined}
        onToggleShare={canShareScreen ? () => void session.toggleScreenShare() : undefined}
        chatOpen={chat ? chatOpen : undefined}
        onToggleChat={
          chat
            ? () => {
                setChatOpen((open) => {
                  if (!open) setChatUnread(0);
                  return !open;
                });
              }
            : undefined
        }
        chatUnread={chatUnread}
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
