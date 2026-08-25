"use client";

import * as React from "react";

/**
 * A local countdown to a server-issued deadline — the 60-second ring on both
 * sides of the instant-request handshake (SPEC §7.4, §10.2 ProgressRing).
 *
 * **Cosmetic, by design.** `expires_at` is written and enforced by Postgres; the
 * accept transaction rejects a request past it and the expiry cron sweeps it.
 * This hook only renders the same number, so clock skew in the browser can make
 * the ring a second or two out without any consequence for what is charged or
 * accepted (§7.4: "Expiry is enforced server-side. The client countdown is
 * cosmetic.").
 *
 * **This `setInterval` is not polling.** CLAUDE.md forbids `setInterval` polling
 * outside the presence heartbeat; what it forbids is asking the server for state
 * on a timer. This ticks a number already in hand and makes no network call —
 * every actual state change on this screen arrives over Realtime.
 *
 * **The number is derived, never stored.** It used to be `useState` seeded by an
 * effect, which meant that on the render where `expiresAt` first became non-null
 * the deadline was already real while `secondsLeft` was still the previous 0 —
 * so `elapsed` read `true` for one render on a countdown that had not started.
 * Any consumer with an effect on `elapsed` acted on that render: the tutor's
 * incoming-request modal dropped the request in the same flush that seeded the
 * countdown, and never painted at all. Reading the clock against the deadline
 * during render removes the window rather than guarding it — there is no stored
 * value left that can belong to a previous deadline. See docs/DECISIONS.md,
 * "The tutor's modal never painted".
 */
export interface Countdown {
  /** Whole seconds remaining, floored at 0. */
  secondsLeft: number;
  /** 1 → 0 fraction of the window remaining, for the ring. */
  fraction: number;
  /** True once the deadline has passed. */
  elapsed: boolean;
}

export function useCountdown(
  /** ISO-8601 deadline, or null when nothing is running. */
  expiresAt: string | null,
  /** Total window in seconds, for the ring's fraction. */
  totalSeconds: number,
): Countdown {
  const deadline = React.useMemo(
    () => (expiresAt ? new Date(expiresAt).getTime() : null),
    [expiresAt],
  );

  const read = React.useCallback((): number => {
    if (deadline == null) return 0;
    return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  }, [deadline]);

  // The interval's only job is to re-render; it holds no countdown state, so
  // there is nothing for it to seed and nothing to be stale between deadlines.
  const [, tick] = React.useReducer((n: number) => n + 1, 0);

  React.useEffect(() => {
    if (deadline == null) return;
    if (deadline - Date.now() <= 0) return;

    const timer = setInterval(() => {
      tick();
      if (deadline - Date.now() <= 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline]);

  // Read the clock here, against the deadline this render actually has. A
  // deadline that arrived this render is measured against it immediately, so a
  // fresh countdown cannot report itself elapsed.
  const secondsLeft = read();
  const total = totalSeconds > 0 ? totalSeconds : 1;
  return {
    secondsLeft,
    fraction: Math.max(0, Math.min(1, secondsLeft / total)),
    elapsed: deadline != null && secondsLeft <= 0,
  };
}
