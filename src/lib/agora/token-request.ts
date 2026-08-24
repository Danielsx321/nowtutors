/**
 * The wire contract with the Render token service, kept pure and
 * `server-only`-free so the URL shape and the TTL arithmetic are unit-testable.
 *
 * The service is deployed and must not be redeployed or modified (SPEC §9), so
 * its route shape is a fixed external contract rather than something we can fix
 * later: `/rtc/{channel}/{role}/uid/{uid}/?expiry={seconds}` returning
 * `{ "rtcToken": "…" }`. A typo here fails at runtime against a third party, in
 * the one request standing between two people and a session — which is exactly
 * the kind of thing worth an assertion rather than a careful read.
 */

import type { AgoraRole } from "./session-access";

/** What we ask the service for. Agora's own maximum for this service is 24h. */
export const TOKEN_TTL_SECONDS = 3600;

/**
 * How much sooner we tell the client the token dies than it actually does.
 *
 * SPEC §9 step 5: report "a TTL shorter than the token's". The client renews off
 * `expiresAt`, so a margin means renewal lands while the current token is still
 * valid — a renewal that begins after expiry is a reconnect, not a renewal.
 */
export const EXPIRY_MARGIN_SECONDS = 300;

/**
 * The uid component of the token path, fixed at `0`.
 *
 * Zero here means "valid for **any** uid", not "uid zero" — a wildcard token.
 * That is deliberate and is not in tension with the deterministic per-user uid
 * (§9 step 4, `lib/agora/uid.ts`): the token authorizes the *channel*, and the
 * client joins it under its own stable uid. Minting per-uid tokens would buy
 * nothing here, because both uids in a session are derived from ids the server
 * already authorized.
 */
const WILDCARD_UID = 0;

/** The service path for one channel + role. Channel is encoded, never interpolated raw. */
export function rtcTokenPath(
  channel: string,
  role: AgoraRole,
  ttlSeconds: number = TOKEN_TTL_SECONDS,
): string {
  return `/rtc/${encodeURIComponent(channel)}/${role}/uid/${WILDCARD_UID}/?expiry=${ttlSeconds}`;
}

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
 * The token out of a service response, or null if the body isn't one.
 *
 * A 200 carrying something other than `{ rtcToken: string }` is a failure, not a
 * token — returning null makes the caller say so rather than handing the browser
 * `undefined` and letting Agora produce the error three layers away.
 */
export function parseRtcTokenResponse(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const token = (body as { rtcToken?: unknown }).rtcToken;
  return typeof token === "string" && token.length > 0 ? token : null;
}
