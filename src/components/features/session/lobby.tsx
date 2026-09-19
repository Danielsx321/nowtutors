"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, Loader2, Volume2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The step before the room (design overhaul Part 4, research report 02).
 *
 * It checks the devices this participant will actually publish (microphone
 * for everyone, camera for the tutor too, SPEC §9) before anything joins the
 * channel, so a blocked permission is explained and fixed here instead of
 * surfacing as a failed join with the other person already waiting. Join stays
 * disabled until the check passes.
 *
 * The check is the browser's own `getUserMedia`, not the Agora SDK: nothing is
 * published and no token is requested until Join. The preview stream is
 * stopped before `onJoin` runs, so the SDK takes the devices over cleanly. The
 * Join click is also the user gesture browsers want before playing the other
 * person's audio.
 *
 * The speaker test is a short tone synthesised with Web Audio, so there is no
 * sound file to ship.
 */
export interface LobbyProps {
  /** Tutors publish a camera as well as a microphone (§9). */
  needsCamera: boolean;
  otherPartyName: string;
  otherPartyAvatarUrl?: string | null;
  /** "Join session", "Go live"... */
  joinLabel?: string;
  onJoin: () => void;
}

type Check =
  | { state: "checking" }
  | { state: "ready" }
  | { state: "blocked" | "missing" | "busy" | "unsupported" | "failed" };

function problemCopy(state: Check["state"], needsCamera: boolean): string {
  const device = needsCamera ? "Camera or microphone" : "Microphone";
  switch (state) {
    case "blocked":
      return `${device} blocked. Allow it in your browser's address bar, then try again.`;
    case "missing":
      return needsCamera
        ? "No camera or microphone was found. Connect one and try again."
        : "No microphone was found. Connect one and try again.";
    case "busy":
      return "Another app is using your microphone or camera. Close it and try again.";
    case "unsupported":
      return "This browser can't reach a microphone. Try a current Chrome, Edge, Safari or Firefox.";
    default:
      return "We couldn't check your devices. Try again.";
  }
}

function classify(err: unknown): Check["state"] {
  const name = (err as { name?: unknown } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "blocked";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "missing";
  if (name === "NotReadableError" || name === "AbortError") return "busy";
  return "failed";
}

export function Lobby({
  needsCamera,
  otherPartyName,
  otherPartyAvatarUrl,
  joinLabel = "Join session",
  onJoin,
}: LobbyProps) {
  const [check, setCheck] = React.useState<Check>({ state: "checking" });
  const [attempt, setAttempt] = React.useState(0);
  const [level, setLevel] = React.useState(0);
  const streamRef = React.useRef<MediaStream | null>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);

  const release = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    let frame = 0;
    let audio: AudioContext | null = null;
    setCheck({ state: "checking" });

    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCheck({ state: "unsupported" });
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: needsCamera });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (needsCamera && videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {});
        }
        setCheck({ state: "ready" });

        // Mic meter: an AnalyserNode on the live input, read once per frame.
        // A render loop, not a network poll.
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        audio = new Ctx();
        const analyser = audio.createAnalyser();
        analyser.fftSize = 512;
        audio.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
          setLevel(Math.min(1, peak / 64));
          frame = requestAnimationFrame(tick);
        };
        tick();
      } catch (err) {
        if (!cancelled) setCheck({ state: classify(err) });
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      void audio?.close().catch(() => {});
      release();
    };
  }, [needsCamera, attempt, release]);

  const testSpeakers = () => {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.65);
    osc.onended = () => void ctx.close().catch(() => {});
  };

  const join = () => {
    release();
    onJoin();
  };

  const ready = check.state === "ready";
  const problem = check.state !== "checking" && !ready;

  return (
    <section
      aria-labelledby="lobby-title"
      className="mx-auto grid w-full max-w-4xl gap-6 rounded-xl border border-border bg-surface-raised p-5 md:grid-cols-[1.3fr_1fr] md:p-6"
    >
      <div className="relative aspect-video overflow-hidden rounded-lg bg-surface-muted">
        {needsCamera ? (
          <video
            ref={videoRef}
            muted
            playsInline
            aria-label="Your camera preview"
            className={cn("size-full -scale-x-100 object-cover", !ready && "invisible")}
          />
        ) : (
          <div className="grid size-full place-items-center text-small text-text-muted">
            Students join with audio. Your tutor&apos;s video appears in the room.
          </div>
        )}
        {check.state === "checking" && (
          <div className="absolute inset-0 grid place-items-center">
            <Loader2 className="size-6 animate-spin text-text-muted motion-reduce:animate-none" aria-hidden />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <Avatar src={otherPartyAvatarUrl} name={otherPartyName} size="lg" />
          <div className="min-w-0">
            <h2 id="lobby-title" className="font-display text-h3 font-semibold text-text">
              Ready to join?
            </h2>
            <p className="truncate text-small text-text-muted">Your session with {otherPartyName}</p>
          </div>
        </div>

        <div role="status" aria-live="polite" className="space-y-3">
          {check.state === "checking" && (
            <p className="text-small text-text-muted">
              Checking your {needsCamera ? "camera and microphone" : "microphone"}. Allow access if your browser asks.
            </p>
          )}
          {ready && (
            <p className="inline-flex items-center gap-2 text-small text-success">
              <CheckCircle2 className="size-4" aria-hidden />
              {needsCamera ? "Camera and microphone ready" : "Microphone ready"}
            </p>
          )}
          {problem && (
            <div className="space-y-3 rounded-lg border border-danger bg-danger-surface p-3 text-small text-danger">
              <p className="flex gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {problemCopy(check.state, needsCamera)}
              </p>
              <Button size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </Button>
            </div>
          )}
        </div>

        {ready && (
          <div className="space-y-2">
            <p className="text-small font-medium text-text" id="mic-level-label">
              Say something to test your microphone
            </p>
            <div
              role="meter"
              aria-labelledby="mic-level-label"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(level * 100)}
              className="h-2 overflow-hidden rounded-full bg-surface-muted"
            >
              <div className="h-full rounded-full bg-live" style={{ width: `${Math.round(level * 100)}%` }} />
            </div>
            <Button size="sm" variant="ghost" onClick={testSpeakers}>
              <Volume2 aria-hidden />
              Test speakers
            </Button>
          </div>
        )}

        <Button className="mt-auto w-full" size="lg" disabled={!ready} onClick={join}>
          {joinLabel}
        </Button>
      </div>
    </section>
  );
}
