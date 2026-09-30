"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import type { ConnectionState } from "agora-rtc-sdk-ng";
import { toast } from "sonner";
import { SessionClient, type NetworkQuality, type SessionTokenGrant } from "@/lib/agora/client";
import type { PlayableVideoTrack } from "@/components/features/session/video-tile";
import type { TimeStage } from "@/components/features/session/session-timer";
import { useTokenRenewal } from "@/hooks/use-token-renewal";
import { getSessionState } from "@/actions/sessions";

/**
 * The instant session this browser tab is in, held above every route group.
 *
 * **Why it lives here** (mini-player, 2026-09-29): the room at
 * `/session/[bookingId]` is in the `(session)` group, the dashboards in
 * `(student)` and `(tutor)`, and the public pages in `(public)`. Each group has
 * its own layout, so leaving the room used to unmount the room component and,
 * with it, the `SessionClient`: any click away hung up. The root layout is the
 * only level every navigation keeps, so the call is owned here and the room and
 * the mini-player are views of it.
 *
 * **What moved here from `SessionRoom`, unchanged:** the join (token request,
 * `SessionClient.join`), the four event-driven `getSessionState` reads, token
 * renewal, mic and camera, and `finish()`. The server still decides everything
 * about publishing; this sends a booking id and nothing else (CLAUDE.md: tokens
 * are never issued client-side).
 *
 * **What is new:**
 * - The deadline actor. The room's timer used to call the server when it hit
 *   zero, but the timer only exists while a view draws it. One `setTimeout` to
 *   the deadline does it here instead; a timeout, not an interval, so the
 *   polling ban holds.
 * - The time-stage toast, de-duplicated: a timer drawn fresh (room to
 *   mini-player and back) reports its stage again, and the toast must not.
 * - Leaving on sign-in and account pages, so a sign-out path the Log out
 *   buttons don't cover still hangs up.
 *
 * One session at a time: `start()` refuses a second booking while one is held.
 */

export interface SessionMeta {
  bookingId: string;
  /** The room's heading: the subject, or "Tutoring session". */
  title: string;
  /** Under the heading: who with, and for how long. */
  subtitle?: string;
  /** Labels and layout only; the publish decision comes from the token route. */
  viewerIsTutor: boolean;
  viewerName: string;
  viewerAvatarUrl?: string | null;
  otherPartyName: string;
  otherPartyAvatarUrl?: string | null;
  /** ISO-8601 hard stop, server-computed from `started_at` (§7.4), or null before it starts. */
  initialDeadline: string | null;
  /** Booked duration, for the timer's proportion. */
  durationMinutes: number | null;
}

export type CallPhase = "idle" | "connecting" | "joining" | "live" | "error";

export type LeaveReason = "sign-out" | "auth-page" | "finished" | "test";

export interface ActiveSession {
  meta: SessionMeta | null;
  phase: CallPhase;
  error: string | null;
  /** A failure after a successful join. Worth saying, not worth tearing the room down for. */
  notice: string | null;
  quality: NetworkQuality | null;
  connection: ConnectionState | null;
  stage: TimeStage;
  localVideo: PlayableVideoTrack | null;
  remoteVideo: PlayableVideoTrack | null;
  remotePresent: boolean;
  /** Server-issued. Replaced whenever the server tells us a truer one. */
  deadline: string | null;
  /** Terminal: the server closed the session and the call has been torn down. */
  finished: boolean;
  /**
   * The booking's status as the server last reported it, so the ended screen
   * can say "they didn't join" for a `no_show_*` instead of "session ended".
   */
  endedStatus: string | null;
  micEnabled: boolean;
  /** Null for a student: no camera track exists to toggle (§9, media split). */
  cameraEnabled: boolean | null;
  /** Join this booking. False when another booking is already held. */
  start: (meta: SessionMeta) => boolean;
  retry: () => void;
  toggleMic: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  /** The session is over (ended by someone, or out of time): release devices, keep the summary. */
  finish: () => void;
  /** Hang up and forget the session. The booking itself is untouched on the server. */
  leave: (reason: LeaveReason) => void;
  /** The timer's stage report; announced once per stage however many timers draw it. */
  reportStage: (stage: TimeStage) => void;
  /**
   * Log out hung up and the redirect hasn't landed yet. The room shows a line
   * instead of the lobby, whose device check would turn the camera back on.
   */
  signingOut: boolean;
  /** Where the mini-player is, or null when it isn't showing. Toasts move out of its way. */
  playerCorner: PlayerCorner | null;
  setPlayerCorner: (corner: PlayerCorner | null) => void;
}

export type PlayerCorner = "tl" | "tr" | "bl" | "br";

const ActiveSessionContext = React.createContext<ActiveSession | null>(null);

export function useActiveSession(): ActiveSession {
  const value = React.useContext(ActiveSessionContext);
  if (!value) throw new Error("useActiveSession must be used inside ActiveSessionProvider (components/providers.tsx).");
  return value;
}

/**
 * Paths where no call should survive: signing in or up, the auth callback,
 * onboarding and the suspended page. Reaching one mid-session means the person
 * signed out, or their account state changed under them.
 */
const LEAVE_ON = ["/login", "/signup", "/auth/", "/onboarding", "/suspended"];

export function leavesSession(pathname: string): boolean {
  return LEAVE_ON.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`));
}

interface TokenErrorBody {
  error?: unknown;
}

export function ActiveSessionProvider({ children }: { children: React.ReactNode }) {
  const [meta, setMeta] = React.useState<SessionMeta | null>(null);
  const [phase, setPhase] = React.useState<CallPhase>("idle");
  const [quality, setQuality] = React.useState<NetworkQuality | null>(null);
  const [stage, setStage] = React.useState<TimeStage>("normal");
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const [localVideo, setLocalVideo] = React.useState<PlayableVideoTrack | null>(null);
  const [remoteVideo, setRemoteVideo] = React.useState<PlayableVideoTrack | null>(null);
  const [remotePresent, setRemotePresent] = React.useState(false);
  const [connection, setConnection] = React.useState<ConnectionState | null>(null);
  const [deadline, setDeadline] = React.useState<string | null>(null);
  /** `created_at + INSTANT_UNMET_GRACE_MINUTES` while the pair has not met (§12). */
  const [unmetDeadline, setUnmetDeadline] = React.useState<string | null>(null);
  const [endedStatus, setEndedStatus] = React.useState<string | null>(null);
  const [finished, setFinished] = React.useState(false);
  /** The current token's server-reported expiry (§9 step 5). Drives renewal below. */
  const [tokenExpiresAt, setTokenExpiresAt] = React.useState<string | null>(null);
  const [micEnabled, setMicEnabled] = React.useState(true);
  const [cameraEnabled, setCameraEnabled] = React.useState<boolean | null>(null);
  const [playerCorner, setPlayerCorner] = React.useState<PlayerCorner | null>(null);
  const [signingOut, setSigningOut] = React.useState(false);

  const bookingId = meta?.bookingId ?? null;

  /**
   * Held so the call can be torn down from outside the join effect: when the
   * session ends, the devices must be released at once, not at the next
   * cleanup. `close()` on the local tracks is what turns the camera light off.
   */
  const clientRef = React.useRef<SessionClient | null>(null);
  /** The last stage announced, across however many timers have drawn the clock. */
  const lastStage = React.useRef<TimeStage>("normal");

  const resetCall = React.useCallback(() => {
    setError(null);
    setNotice(null);
    setLocalVideo(null);
    setRemoteVideo(null);
    setRemotePresent(false);
    setTokenExpiresAt(null);
    setQuality(null);
    setConnection(null);
  }, []);

  const finish = React.useCallback(() => {
    setFinished(true);
    void clientRef.current?.leave();
  }, []);

  // Every reason hangs up the same way; a sign-out also keeps the room from
  // reopening the lobby while the redirect is on its way.
  const leave = React.useCallback(
    (reason?: LeaveReason) => {
      if (reason === "sign-out") setSigningOut(true);
      // Clearing `meta` runs the join effect's cleanup, which leaves the channel.
      // The direct call covers a client the effect no longer owns.
      void clientRef.current?.leave();
      clientRef.current = null;
      resetCall();
      setMeta(null);
      setPhase("idle");
      setFinished(false);
      setDeadline(null);
      setStage("normal");
      lastStage.current = "normal";
    },
    [resetCall],
  );

  /**
   * Ask the server what is actually true. Never on an interval: on start, when
   * the other party arrives, when they leave, and once at the deadline.
   *
   * At the deadline this is also the actor: `getSessionState` performs the
   * transition server-side when the booked time has run out. A failure is
   * deliberately silent; the token route will refuse the next credential
   * anyway, and the cron closes the row regardless.
   */
  const refreshState = React.useCallback(async () => {
    if (!bookingId) return;
    try {
      const result = await getSessionState(bookingId);
      if ("error" in result) return;
      setDeadline(result.state.deadline);
      setUnmetDeadline(result.state.unmetDeadline ?? null);
      setEndedStatus(result.state.status);
      if (result.state.finished) finish();
    } catch {
      // Intentionally ignored; see above.
    }
  }, [bookingId, finish]);

  // Read by the SDK handlers, which are bound once per join.
  const refreshRef = React.useRef(refreshState);
  refreshRef.current = refreshState;

  // On start: the page rendered from a read that may predate the other party's
  // arrival, so the deadline it handed down can already be stale.
  React.useEffect(() => {
    if (bookingId) void refreshState();
  }, [bookingId, refreshState]);

  // The other party arrived: their join writes `started_at`, so the deadline
  // exists now. The SDK event is the push signal; the guarded read is the data.
  const wasPresent = React.useRef(false);
  React.useEffect(() => {
    if (remotePresent && !wasPresent.current) void refreshState();
    wasPresent.current = remotePresent;
  }, [remotePresent, refreshState]);

  // The deadline actor: one timeout, re-armed when the server corrects the
  // deadline. A second past it, so the server's clock agrees it has passed.
  React.useEffect(() => {
    if (!deadline || finished || phase !== "live") return;
    const wait = Math.max(0, new Date(deadline).getTime() - Date.now()) + 1000;
    const timer = setTimeout(() => void refreshRef.current(), wait);
    return () => clearTimeout(timer);
  }, [deadline, finished, phase]);

  // The unmet actor (2026-09-30): the same shape for the person waiting alone.
  // The server hands down `unmetDeadline` while `started_at` is null; a second
  // past it the room asks again and `getSessionState` closes the booking as a
  // no-show. Cleared by the server the moment the other party arrives.
  React.useEffect(() => {
    if (!unmetDeadline || finished || phase !== "live") return;
    const wait = Math.max(0, new Date(unmetDeadline).getTime() - Date.now()) + 1000;
    const timer = setTimeout(() => void refreshRef.current(), wait);
    return () => clearTimeout(timer);
  }, [unmetDeadline, finished, phase]);

  React.useEffect(() => {
    // Nothing joins until the room's lobby calls `start()`.
    if (!bookingId) return;
    // Constructed synchronously so the cleanup can always dispose it, including
    // while the join is still awaiting device permission.
    const client = new SessionClient({
      onLocalVideo: setLocalVideo,
      onRemoteVideo: setRemoteVideo,
      onRemotePresence: (present) => {
        setRemotePresent(present);
        // The other person left the channel. If they ended the session the
        // server has closed it already, and this is how this side finds out.
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
          setError(typeof message === "string" ? message : "Couldn't connect to this session.");
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
    // `attempt` is the retry trigger. Navigation changes neither dependency,
    // which is the whole point of this provider.
  }, [bookingId, attempt]);

  const start = React.useCallback(
    (next: SessionMeta) => {
      if (meta && meta.bookingId !== next.bookingId) return false;
      if (meta && phase !== "idle") return true;
      resetCall();
      setSigningOut(false);
      setFinished(false);
      setDeadline(next.initialDeadline);
      setMicEnabled(true);
      setCameraEnabled(next.viewerIsTutor ? true : null);
      setStage("normal");
      lastStage.current = "normal";
      setMeta(next);
      setPhase("connecting");
      return true;
    },
    [meta, phase, resetCall],
  );

  const retry = React.useCallback(() => {
    resetCall();
    setPhase("connecting");
    setAttempt((n) => n + 1);
  }, [resetCall]);

  /** Swap the renewed token in without dropping the connection (§9 step 6). */
  const handleRenewed = React.useCallback(async (grant: SessionTokenGrant) => {
    try {
      await clientRef.current?.renewToken(grant.token);
      setTokenExpiresAt(grant.expiresAt);
    } catch (err) {
      setNotice(describeJoinError(err));
    }
  }, []);

  /** The renewal was refused: the server has spoken, so ask it what is true. */
  const handleRenewalRefused = React.useCallback(() => {
    void refreshRef.current();
  }, []);

  useTokenRenewal({ bookingId: bookingId ?? "" }, bookingId ? tokenExpiresAt : null, handleRenewed, handleRenewalRefused);

  const toggleMic = React.useCallback(async () => {
    const next = await clientRef.current?.toggleMic();
    if (next !== undefined) setMicEnabled(next);
  }, []);

  const toggleCamera = React.useCallback(async () => {
    const next = await clientRef.current?.toggleCamera();
    // `undefined` means no client yet; `null` (no camera track) is a real answer.
    if (next !== undefined) setCameraEnabled(next);
  }, []);

  const reportStage = React.useCallback((next: TimeStage) => {
    if (next === lastStage.current) return;
    lastStage.current = next;
    setStage(next);
    if (next === "five") toast("5 minutes left in this session.");
  }, []);

  // Sign-in and account pages: hang up (see LEAVE_ON).
  const pathname = usePathname() ?? "";
  React.useEffect(() => {
    if (bookingId && leavesSession(pathname)) leave("auth-page");
  }, [pathname, bookingId, leave]);

  const value = React.useMemo<ActiveSession>(
    () => ({
      meta,
      phase,
      error,
      notice,
      quality,
      connection,
      stage,
      localVideo,
      remoteVideo,
      remotePresent,
      deadline,
      finished,
      endedStatus,
      micEnabled,
      cameraEnabled,
      start,
      retry,
      toggleMic,
      toggleCamera,
      finish,
      leave,
      reportStage,
      signingOut,
      playerCorner,
      setPlayerCorner,
    }),
    [
      meta,
      phase,
      error,
      notice,
      quality,
      connection,
      stage,
      localVideo,
      remoteVideo,
      remotePresent,
      deadline,
      finished,
      endedStatus,
      micEnabled,
      cameraEnabled,
      start,
      retry,
      toggleMic,
      toggleCamera,
      finish,
      leave,
      reportStage,
      signingOut,
      playerCorner,
    ],
  );

  return <ActiveSessionContext.Provider value={value}>{children}</ActiveSessionContext.Provider>;
}

/**
 * Turn an SDK or network failure into something the person can act on.
 * Agora's own messages name internal codes; "PERMISSION_DENIED" is not an
 * instruction to anyone.
 */
export function describeJoinError(err: unknown): string {
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
