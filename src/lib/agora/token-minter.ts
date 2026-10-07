import "server-only";
import { buildRtcToken, isValidAgoraCredential } from "./token-builder";
import { TOKEN_TTL_SECONDS } from "./token-request";
import type { AgoraRole } from "./session-access";

/**
 * The one place Agora tokens are minted (SPEC §9, amended 2026-10-07; CLAUDE.md:
 * "All Agora tokens are minted server-side in /api/agora/token with the App
 * Certificate; never client-side"). Reads the App ID and the App Certificate
 * from env and hands them to the pure builder in `token-builder.ts`.
 *
 * Until 2026-10-07 tokens came from a reused Render service over HTTP. That hop
 * is gone: no outbound request, no cold start, and no public minting endpoint
 * (code review T2).
 *
 * **The certificate is a secret.** It is read lazily (never at import), checked
 * for shape, and never logged, never put in an error message, never returned.
 * Errors name the variable only.
 */

/** Raised when an Agora env var is unset or can't be a real value. */
export class AgoraConfigError extends Error {
  readonly code = "agora_not_configured" as const;
  constructor(missing: string) {
    super(`Agora is not configured: ${missing} is unset or malformed.`);
    this.name = "AgoraConfigError";
  }
}

/** Raised when a token could not be built from a configuration that looked valid. */
export class AgoraTokenMintError extends Error {
  readonly code = "agora_token_mint_error" as const;
  constructor(readonly detail: string) {
    super(`Agora token could not be minted: ${detail}`);
    this.name = "AgoraTokenMintError";
  }
}

/** Agora's own ceiling for a token or privilege lifetime. */
const MAX_TTL_SECONDS = 24 * 60 * 60;

/**
 * `NEXT_PUBLIC_AGORA_APP_ID`. Public by design (the browser needs it to join),
 * but returned through the token route rather than read from the client bundle,
 * so the app id and the token that authorizes it always come from one answer and
 * cannot drift apart across environments.
 */
export function agoraAppId(): string {
  const raw = process.env.NEXT_PUBLIC_AGORA_APP_ID?.trim();
  if (!raw) throw new AgoraConfigError("NEXT_PUBLIC_AGORA_APP_ID");
  return raw;
}

/**
 * `AGORA_APP_CERTIFICATE`: server only, never `NEXT_PUBLIC_`. Surrounding
 * whitespace from a paste is trimmed; anything that still isn't 32 hex
 * characters, or is the App ID pasted into the wrong box, is "not configured"
 * (a clean 503) instead of a token Agora would silently reject.
 */
export function agoraAppCertificate(): string {
  const raw = process.env.AGORA_APP_CERTIFICATE?.trim();
  if (!isValidAgoraCredential(raw)) throw new AgoraConfigError("AGORA_APP_CERTIFICATE");
  if (raw.toLowerCase() === process.env.NEXT_PUBLIC_AGORA_APP_ID?.trim().toLowerCase()) {
    throw new AgoraConfigError("AGORA_APP_CERTIFICATE");
  }
  return raw;
}

/**
 * An RTC token for an already-authorized `channel` and `role`, valid for
 * `ttlSeconds` (token and privileges alike).
 *
 * Synchronous: minting is a few HMACs in this process. A missing or malformed
 * env var leaves as {@link AgoraConfigError}; anything else that goes wrong
 * leaves as {@link AgoraTokenMintError}. Nothing raw escapes.
 */
export function mintRtcToken(
  channel: string,
  role: AgoraRole,
  ttlSeconds: number = TOKEN_TTL_SECONDS,
): string {
  const appId = agoraAppId();
  const appCertificate = agoraAppCertificate();
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_TTL_SECONDS) {
    throw new AgoraTokenMintError(`ttl ${ttlSeconds} is outside 1..${MAX_TTL_SECONDS}`);
  }
  try {
    return buildRtcToken({ appId, appCertificate, channel, role, ttlSeconds });
  } catch (err) {
    // The builder's own messages carry no credential; the cause is dropped
    // anyway, so nothing it holds can reach a log line.
    throw new AgoraTokenMintError(err instanceof Error ? err.message : "builder threw");
  }
}
