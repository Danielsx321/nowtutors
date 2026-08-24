"use client";

import * as React from "react";
import { renewalDelayMs, RENEWAL_RETRY_MS } from "@/lib/agora/renewal";
import type { SessionTokenGrant } from "@/lib/agora/client";

/**
 * Schedules the SPEC §9 step 6 token renewal off the server-reported
 * `expiresAt` — a single `setTimeout`, not a periodic check (CLAUDE.md: no
 * polling outside the presence heartbeat). `/api/agora/token` reports
 * `expiresAt` five minutes before the token's real expiry (DECISIONS, Phase 6
 * Part 3A) precisely so this fires while the current token is still valid.
 *
 * Renewal re-runs the token route's existing checks unchanged — participation
 * and the elapsed refusal Part 3B added. A renewal past the deadline is
 * refused the same way an initial join is, and that refusal's best-effort
 * deadline transition applies unchanged; this hook does not special-case it.
 * `onRefused` is how the caller learns a renewal came back non-OK so it can
 * ask the server what is actually true (the same `refreshState` the timer's
 * `onExpired` already calls) rather than this hook guessing.
 */
export function useTokenRenewal(
  bookingId: string,
  /** The current token's server-reported expiry, or null before the first join. */
  expiresAt: string | null,
  /** Swap the renewed token into the live client without dropping the connection. */
  onRenewed: (grant: SessionTokenGrant) => void | Promise<void>,
  /** A renewal request came back non-2xx, or the fetch itself failed after a retry. */
  onRefused?: (body: unknown) => void,
): void {
  const onRenewedRef = React.useRef(onRenewed);
  onRenewedRef.current = onRenewed;
  const onRefusedRef = React.useRef(onRefused);
  onRefusedRef.current = onRefused;

  React.useEffect(() => {
    if (!expiresAt) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    async function attempt(isRetry: boolean): Promise<void> {
      try {
        const res = await fetch("/api/agora/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookingId }),
          cache: "no-store",
        });
        const body: unknown = await res.json().catch(() => null);
        if (cancelled) return;

        if (!res.ok) {
          // The route's checks ran and refused — the server has spoken, and a
          // fixed retry would only ask it the same question again. The caller
          // resolves truth (e.g. the deadline actor) instead of this hook
          // guessing at a backoff.
          onRefusedRef.current?.(body);
          return;
        }
        await onRenewedRef.current(body as SessionTokenGrant);
      } catch {
        // A network failure, not a refusal — the route's checks never ran.
        // One retry on a fixed delay, not a recurring timer: still
        // event-driven, just triggered by failure instead of success.
        if (cancelled || isRetry) return;
        retryTimer = setTimeout(() => void attempt(true), RENEWAL_RETRY_MS);
      }
    }

    const timer = setTimeout(() => void attempt(false), renewalDelayMs(expiresAt));

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [bookingId, expiresAt]);
}
