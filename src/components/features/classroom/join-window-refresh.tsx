"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useCountdown } from "@/hooks/use-countdown";

/**
 * Re-ask the server at the instant the join window opens or closes
 * (SPEC §7.3, §7.7).
 *
 * **It decides nothing.** The window is one pure server-side decision
 * (`checkLessonSpaceAccess`), and every screen that shows a join state renders
 * that decision's answer. The problem this solves is only that a Server
 * Component's answer is a snapshot: someone sitting on a booking page at
 * 2:49 PM would still be looking at "opens at 2:50" a minute later. This fires
 * `router.refresh()` **once**, at the boundary, and the server re-decides. A
 * browser clock running fast gets the same "not yet" it had before and simply
 * re-renders; it cannot talk itself into a classroom.
 *
 * **`setTimeout`, not `setInterval`** — CLAUDE.md forbids polling outside the
 * presence heartbeat, and this is a single scheduled wake-up at a known instant,
 * not a repeating question. The same shape as `SessionTimer`'s one-shot
 * `onExpired`, and the same reason.
 */
export function JoinWindowRefresh({ at }: { at: string }) {
  const router = useRouter();

  React.useEffect(() => {
    const ms = new Date(at).getTime() - Date.now();
    if (Number.isNaN(ms)) return;
    // A small cushion so the server's own `new Date()` is unambiguously past the
    // boundary when it re-decides — the edges are inclusive, but a refresh that
    // lands a few milliseconds early would just bounce back to the same panel.
    const timer = setTimeout(() => router.refresh(), Math.max(0, ms) + 1_000);
    return () => clearTimeout(timer);
  }, [at, router]);

  return null;
}

/**
 * "Opens in 4:32" — the wait, counted down, for the too-early panel.
 *
 * Cosmetic in exactly the sense `SessionTimer` is: it renders a number derived
 * from an instant the server computed, makes no network call, and is not what
 * opens the room. {@link JoinWindowRefresh} is what asks the server again.
 *
 * Rendered only when the wait is short enough to be worth watching — see
 * {@link COUNTDOWN_VISIBLE_MS} — because a per-second tick for a session three
 * hours out is a timer nobody reads.
 */
export const COUNTDOWN_VISIBLE_MS = 60 * 60 * 1000;

export function OpensInCountdown({ opensAt }: { opensAt: string }) {
  const target = new Date(opensAt).getTime();
  const totalSeconds = Math.max(
    1,
    Math.ceil((target - Date.now()) / 1000),
  );
  const { secondsLeft } = useCountdown(opensAt, totalSeconds);

  if (secondsLeft <= 0) return null;

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  return (
    <p
      role="timer"
      aria-live="off"
      aria-label={`Opens in about ${minutes === 0 ? `${seconds} seconds` : minutes === 1 ? "1 minute" : `${minutes} minutes`}`}
      className="font-mono text-h3 tabular-nums text-white"
    >
      {minutes}:{String(seconds).padStart(2, "0")}
    </p>
  );
}
