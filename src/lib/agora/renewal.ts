/**
 * When to renew the Agora token (SPEC §9 step 6, deferred from Part 3B).
 *
 * Pure and `server-only`-free so the scheduling arithmetic is unit-testable
 * without the SDK or a timer harness. `/api/agora/token` already reports
 * `expiresAt` five minutes before the token's real expiry specifically so this
 * can fire while the current token is still valid (DECISIONS, Phase 6 Part
 * 3A, "Token TTL, timeouts, and the wildcard uid") — renewal is scheduled off
 * that known value, not a periodic check (CLAUDE.md: no polling outside the
 * presence heartbeat).
 */

/** How long to wait before retrying a renewal request that failed. */
export const RENEWAL_RETRY_MS = 30_000;

/**
 * Milliseconds from `now` until `expiresAt`, floored at 0.
 *
 * A past or immediate `expiresAt` (a clock that woke from sleep, a very short
 * remaining session) schedules an immediate renewal rather than a negative
 * delay, which `setTimeout` would otherwise treat as zero anyway — floored
 * explicitly so the intent is not left to that coincidence.
 */
export function renewalDelayMs(
  expiresAt: string | Date,
  now: Date = new Date(),
): number {
  const target =
    typeof expiresAt === "string" ? new Date(expiresAt).getTime() : expiresAt.getTime();
  return Math.max(0, target - now.getTime());
}
