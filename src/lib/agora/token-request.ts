/**
 * Token lifetimes, kept pure and `server-only`-free so the TTL arithmetic is
 * unit-testable: how long a token lives, how much earlier the client is told it
 * dies, and how a session token is capped at its session (T1).
 *
 * Until 2026-10-07 this file was also the wire contract with the Render token
 * service (its URL path and response shape). Tokens are now built in-app
 * (`token-builder.ts`, `token-minter.ts`), so only the lifetimes are left here.
 */

import { sessionDeadline, type SessionTiming } from "@/lib/sessions/deadline";

/** The standard token lifetime. Agora's own maximum is 24h. */
export const TOKEN_TTL_SECONDS = 3600;

/**
 * How much sooner we tell the client the token dies than it actually does.
 *
 * SPEC §9 step 5: report "a TTL shorter than the token's". The client renews off
 * `expiresAt`, so a margin means renewal lands while the current token is still
 * valid — a renewal that begins after expiry is a reconnect, not a renewal.
 */
export const EXPIRY_MARGIN_SECONDS = 300;

/** When we tell the client to stop trusting the token (always before it expires). */
export function tokenExpiresAt(
  issuedAt: Date,
  ttlSeconds: number = TOKEN_TTL_SECONDS,
  marginSeconds: number = EXPIRY_MARGIN_SECONDS,
): Date {
  const effective = Math.max(ttlSeconds - marginSeconds, 1);
  return new Date(issuedAt.getTime() + effective * 1000);
}

/**
 * How long past the deadline a session token stays valid. Long enough that a
 * clock a few seconds off between this server and Agora never cuts a paid
 * session short; short enough to mean nothing as free time.
 */
export const DEADLINE_GRACE_SECONDS = 60;

export interface TokenLifetime {
  /** How long the minted token (and every privilege in it) lasts. */
  ttlSeconds: number;
  /** When the client should ask again, counted from now. */
  renewAfterSeconds: number;
}

/**
 * How long a session token may live (SPEC §7.4; code review 2026-09-20, T1).
 *
 * **A token must not outlive the session it was issued for.** The route refuses
 * a new token once the booked time is up, but a token already in hand kept
 * working: every one lasted {@link TOKEN_TTL_SECONDS} whatever was booked, so a
 * 30-minute session's token was good for 60 and the hard stop rested on the
 * client choosing to leave. Now the token itself runs out.
 *
 *  - **Started:** the time left plus {@link DEADLINE_GRACE_SECONDS}, never more
 *    than the default. When that cap applies the client is told to ask again
 *    *at the deadline*, not five minutes before the token expires: there is
 *    nothing to renew into, the ask is refused, and an early one would re-ask
 *    every second for the last five minutes.
 *  - **Not started yet** (the other person hasn't arrived): the booked
 *    duration. The clock starts when both are present, which is never before
 *    this join, so such a token can't outlive the deadline either, and its
 *    renewal lands on the branch above.
 */
export function sessionTokenLifetime(timing: SessionTiming, now: Date): TokenLifetime {
  const standard: TokenLifetime = {
    ttlSeconds: TOKEN_TTL_SECONDS,
    renewAfterSeconds: TOKEN_TTL_SECONDS - EXPIRY_MARGIN_SECONDS,
  };

  const deadline = sessionDeadline(timing);
  if (deadline !== null) {
    const left = Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / 1000));
    if (left + DEADLINE_GRACE_SECONDS >= TOKEN_TTL_SECONDS) return standard;
    return { ttlSeconds: left + DEADLINE_GRACE_SECONDS, renewAfterSeconds: left };
  }

  const { durationMinutes } = timing;
  if (durationMinutes === null || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return standard;
  }
  const booked = Math.round(durationMinutes * 60);
  if (booked >= TOKEN_TTL_SECONDS) return standard;
  return {
    ttlSeconds: booked,
    renewAfterSeconds: Math.max(booked - EXPIRY_MARGIN_SECONDS, Math.ceil(booked / 2)),
  };
}
