import agoraToken from "agora-token";
import type { AgoraRole } from "./session-access";

/**
 * Builds an Agora RTC token (AccessToken2, the `007…` format) with Agora's own
 * Node builder, `agora-token` (SPEC §9, amended 2026-10-07).
 *
 * Pure and `server-only`-free so the token's contents are unit-testable by
 * decoding it (`tests/unit/agora-token-builder.test.ts`). It reads no env and
 * knows nothing about who is asking: the route has already decided the channel
 * and the role. The server-only wrapper that supplies the credentials is
 * `token-minter.ts`.
 */

// CommonJS package with no named ESM exports, so it is read off the default.
const { RtcTokenBuilder, RtcRole } = agoraToken;

/**
 * The uid the token is minted for, fixed at `0`.
 *
 * Zero here means "valid for **any** uid", not "uid zero": a wildcard token.
 * That is deliberate and is not in tension with the deterministic per-user uid
 * (§9 step 4, `lib/agora/uid.ts`): the token authorizes the *channel*, and the
 * client joins it under its own stable uid. Minting per-uid tokens would buy
 * little here, because both uids in a session are derived from ids the server
 * already authorized. (Possible later hardening: mint for `agoraUid(user.id)`.)
 */
export const WILDCARD_UID = 0;

/** App IDs and certificates are both 32 hexadecimal characters. */
const CREDENTIAL_SHAPE = /^[0-9a-fA-F]{32}$/;

/** True for a value shaped like an Agora App ID or App Certificate. Never echoes it. */
export function isValidAgoraCredential(value: unknown): value is string {
  return typeof value === "string" && CREDENTIAL_SHAPE.test(value);
}

export interface RtcTokenInput {
  appId: string;
  appCertificate: string;
  channel: string;
  role: AgoraRole;
  /** Seconds from now. Used for the token AND every privilege in it. */
  ttlSeconds: number;
}

function rtcRole(role: AgoraRole): number {
  switch (role) {
    case "publisher":
      return RtcRole.PUBLISHER;
    case "subscriber":
      return RtcRole.SUBSCRIBER;
    default: {
      const unknownRole: never = role;
      throw new Error(`Unknown Agora role: ${String(unknownRole)}`);
    }
  }
}

/**
 * One RTC token for `channel` at `role`, for the wildcard uid.
 *
 * **Privilege expiry equals token expiry.** `agora-token` defaults a privilege's
 * expiry to 0, which would leave the join and publish privileges without the
 * limit the token has; passing the same TTL for both keeps the T1 rule (a session
 * token runs out with its session) true of everything inside the token.
 *
 * Throws when the library would return an empty string (it does that for a
 * malformed app id or certificate) rather than handing the browser "" to fail
 * on inside Agora. The error never carries either credential.
 */
export function buildRtcToken(input: RtcTokenInput): string {
  const { appId, appCertificate, channel, role, ttlSeconds } = input;
  const agoraRole = rtcRole(role);
  if (!isValidAgoraCredential(appId) || !isValidAgoraCredential(appCertificate)) {
    throw new Error("Agora app id or certificate is not 32 hex characters.");
  }
  const token = RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCertificate,
    channel,
    WILDCARD_UID,
    agoraRole,
    ttlSeconds,
    ttlSeconds,
  );
  if (!token) throw new Error("Agora token builder returned no token.");
  return token;
}
