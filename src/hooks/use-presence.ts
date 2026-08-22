"use client";

import * as React from "react";

/**
 * `usePresence()` — the presence heartbeat (SPEC §7.5). Mounted once in the
 * authenticated shell (`components/layout/app-shell.tsx`), so it runs for every
 * signed-in page and nowhere else.
 *
 * Behaviour, verbatim from §7.5:
 *   - fire once immediately on mount;
 *   - every 30s **while the tab is visible**;
 *   - pause on `document.hidden`, and fire immediately again on visible (rather
 *     than waiting out the remainder of an interval the user can't see);
 *   - `navigator.sendBeacon` on `pagehide` for the clean-exit path.
 *
 * This interval is the ONE exception to CLAUDE.md's "no setInterval polling
 * anywhere" rule, and it is named there as such. It carries no data and reads
 * nothing back — everything else that would have polled uses Realtime.
 *
 * The `exit` beacon is a departure signal, not a last heartbeat: it clears a
 * tutor's `is_live` and leaves `last_seen_at` alone. Sending a heartbeat on the
 * way out would keep a departed tutor on the live list for the full staleness
 * window, which is the opposite of what defence 3 is for.
 */

const HEARTBEAT_URL = "/api/presence/heartbeat";
const HEARTBEAT_INTERVAL_MS = 30_000;

export function usePresence(): void {
  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const beat = () => {
      if (cancelled || document.hidden) return;
      void fetch(HEARTBEAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "heartbeat" }),
        keepalive: true,
        // Presence is best-effort: a failed beat is corrected by the next one,
        // and by the view/sweep if there is no next one. Never surface it.
      }).catch(() => {});
    };

    const startTimer = () => {
      if (timer !== null) return;
      timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
    };

    const stopTimer = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        stopTimer();
        return;
      }
      beat();
      startTimer();
    };

    const onPageHide = () => {
      stopTimer();
      const payload = JSON.stringify({ event: "exit" });
      // sendBeacon cannot set headers; the route sniffs the body, not the type.
      const sent =
        typeof navigator !== "undefined" &&
        typeof navigator.sendBeacon === "function" &&
        navigator.sendBeacon(
          HEARTBEAT_URL,
          new Blob([payload], { type: "application/json" }),
        );
      if (!sent) {
        // No sendBeacon (or it refused the payload): keepalive fetch is the
        // fallback. If both fail the sweep and the view still cover it.
        void fetch(HEARTBEAT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      }
    };

    beat();
    if (!document.hidden) startTimer();

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      cancelled = true;
      stopTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);
}
