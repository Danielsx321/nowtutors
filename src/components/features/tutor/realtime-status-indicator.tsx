"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";

/**
 * "You are live, and you are not receiving requests."
 *
 * Until this existed that sentence was true and completely invisible: a tutor
 * whose subscription never established showed as live on the browse page, saw a
 * perfectly normal `/tutor` shell, and simply never got a modal — while a
 * student on the other side watched a ring run out. The only trace was a
 * `console.error` nobody has open. A tutor cannot be asked to trust "you are
 * live" if the app will not say when the thing behind it is broken.
 *
 * **Quiet by construction.** It renders only while the subscription is
 * `unavailable` — i.e. an attempt has already FAILED and a retry is scheduled.
 * The first connect shows nothing at all, because a warning that flashes on
 * every page load is a warning people learn to look past, and normal startup is
 * not news. It disappears on its own when a retry succeeds; there is nothing to
 * dismiss and no action to take, so it offers neither.
 *
 * **Tokens only (§10.1).** `ink-900` fill with an `ink-700` border — the ink
 * shell's own separation rule, since elevation-by-lightness is unavailable on
 * ink — white body text (9.29:1) with `ink-300` secondary (4.69:1), and the
 * `warning` amber for the non-text dot (4.55:1 on ink-900, past the 3:1
 * non-text floor). No hardcoded hex, and deliberately not live-green: green
 * here would be a second meaning for the colour §10.1 reserves for live status.
 */
export function RealtimeStatusIndicator() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 left-4 z-40 max-w-[calc(100vw-2rem)] sm:max-w-sm"
    >
      <div className="flex items-start gap-2.5 rounded-md border border-ink-700 bg-ink-900 px-3 py-2 shadow-md">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0">
          <p className="text-small font-medium text-white">
            Reconnecting to instant requests
          </p>
          <p className="text-caption text-ink-300">
            You may not be notified of new requests until this clears.
          </p>
        </div>
      </div>
    </div>
  );
}
