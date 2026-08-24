"use client";

import * as React from "react";
import { Clock } from "lucide-react";
import { useCountdown } from "@/hooks/use-countdown";
import { cn } from "@/lib/utils";

/**
 * Time left in the session (SPEC §7.4 in-session UI).
 *
 * **Cosmetic, exactly like the 60-second request ring.** It ticks a deadline the
 * server already computed from `bookings.started_at` and handed down; it makes no
 * network call of its own, so it is not the polling CLAUDE.md forbids. Whether
 * the session is actually over is decided by Postgres — a browser clock running
 * fast shows a wrong number for a second or two and changes nothing about what
 * is charged or when the room closes.
 *
 * `onExpired` is the one thing it does beyond rendering: it fires **once** when
 * the number reaches zero, so the room can ask the server what is actually true.
 * That call is the deadline actor (`getSessionState`), and the server re-decides
 * from its own clock — a fast client gets told "not yet" along with the real
 * remaining time, and re-arms.
 */
export interface SessionTimerProps {
  /** ISO-8601 hard stop, or null while the session has not started. */
  deadline: string | null;
  /** Booked duration, for the proportion the bar shows. */
  durationMinutes: number | null;
  /** Fired once, when the local countdown first reaches zero. */
  onExpired?: () => void;
}

export function SessionTimer({
  deadline,
  durationMinutes,
  onExpired,
}: SessionTimerProps) {
  const totalSeconds = (durationMinutes ?? 0) * 60;
  const { secondsLeft, fraction, elapsed } = useCountdown(deadline, totalSeconds);

  // Once per deadline, not once per render. Re-arms if the server hands down a
  // corrected deadline, which is what makes the skew correction work.
  const fired = React.useRef<string | null>(null);
  const onExpiredRef = React.useRef(onExpired);
  onExpiredRef.current = onExpired;

  React.useEffect(() => {
    if (!deadline || !elapsed) return;
    if (fired.current === deadline) return;
    fired.current = deadline;
    onExpiredRef.current?.();
  }, [deadline, elapsed]);

  if (!deadline) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 text-small text-ink-300"
      >
        <Clock className="size-4 shrink-0" aria-hidden />
        Timer starts when you&apos;re both here
      </div>
    );
  }

  // Under five minutes is where a person starts caring; say it in colour as well
  // as in the number, since the consequence (a hard stop, no extension) is not
  // recoverable once it lands.
  const urgent = secondsLeft <= 300;

  return (
    <div className="flex items-center gap-3">
      <div
        role="timer"
        // Announced on a coarse interval by the browser rather than every second
        // — a per-second live region is unusable with a screen reader.
        aria-live="off"
        aria-label={`${formatSpoken(secondsLeft)} remaining in this session`}
        className={cn(
          "flex items-center gap-2 font-mono text-body tabular-nums",
          urgent ? "text-warning" : "text-white",
        )}
      >
        <Clock className="size-4 shrink-0" aria-hidden />
        <span>{formatClock(secondsLeft)}</span>
      </div>
      <div
        className="h-1.5 w-24 overflow-hidden rounded-full bg-ink-700"
        aria-hidden
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-1000 ease-linear motion-reduce:transition-none",
            urgent ? "bg-warning" : "bg-live-500",
          )}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
    </div>
  );
}

/** `m:ss` under an hour, `h:mm:ss` at or over it. */
function formatClock(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = String(minutes).padStart(hours > 0 ? 2 : 1, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Words, not a colon-separated string a screen reader would spell out. */
function formatSpoken(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  if (s === 0) return "No time";
  const minutes = Math.round(s / 60);
  if (minutes < 1) return `${s} seconds`;
  if (minutes === 1) return "1 minute";
  return `${minutes} minutes`;
}
