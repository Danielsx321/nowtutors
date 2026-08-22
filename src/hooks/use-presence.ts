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
 *     than waiting out the remainder of an interval the user can't see).
 *
 * This interval is the ONE exception to CLAUDE.md's "no setInterval polling
 * anywhere" rule, and it is named there as such. It carries no data and reads
 * nothing back — everything else that would have polled uses Realtime.
 *
 * **There is deliberately no `pagehide` / `sendBeacon` handler.** An earlier
 * revision fired one to clear a departing tutor's `is_live`. It was removed
 * because `pagehide` cannot tell a reload from a real exit: a tutor who
 * refreshed `/tutor` was silently dropped offline while the toggle still read
 * "live" to them. Ungraceful exit is already handled at read time by the
 * `live_tutors` view (§3.1) and tidied by the sweep cron (§7.5, §12), so the
 * beacon bought no correctness — only that false positive. Deliberate
 * toggle-off remains immediate and explicit (`actions/presence.ts`).
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

    beat();
    if (!document.hidden) startTimer();

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      stopTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);
}
