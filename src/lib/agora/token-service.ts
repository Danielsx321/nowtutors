import "server-only";
import {
  parseRtcTokenResponse,
  rtcTokenPath,
  TOKEN_TTL_SECONDS,
} from "./token-request";
import type { AgoraRole } from "./session-access";

/**
 * The one place that talks to the Agora token service (SPEC §9, CLAUDE.md:
 * "All Agora tokens are issued through /api/agora/token, never client-side,
 * never by calling the Render service from the browser"). Same shape as
 * `lib/paypal/client.ts`: base URL from env, a thin typed fetch, no SDK.
 *
 * The service is reused as deployed and is never redeployed or modified.
 */

/** Raised when the server has no token-service URL configured. */
export class AgoraConfigError extends Error {
  readonly code = "agora_not_configured" as const;
  constructor(missing: string) {
    super(`Agora is not configured: ${missing} is unset.`);
    this.name = "AgoraConfigError";
  }
}

/** Raised when the token service answers with a non-2xx, a bad body, or not at all. */
export class AgoraTokenServiceError extends Error {
  readonly code = "agora_token_service_error" as const;
  constructor(
    /** HTTP status, or 0 when the request never completed (timeout/DNS/TLS). */
    readonly status: number,
    readonly detail: string,
  ) {
    super(`Agora token service failed (${status}): ${detail}`);
    this.name = "AgoraTokenServiceError";
  }
}

/**
 * How long we wait on the token service.
 *
 * Generous on purpose. The service runs on Render's free tier, which sleeps; SPEC
 * §9's cold-start note measures the first request after idle at 30–50 seconds
 * (a probe during this build took 22s). A tight timeout would turn every
 * cold start into a failed join. The warm ping in `cron/sweep-presence` is what
 * makes hitting this ceiling rare; this value is what stops it being fatal when
 * the ping hasn't run recently enough.
 */
const REQUEST_TIMEOUT_MS = 45_000;

/** Shorter, because nothing waits on it — the ping's only job is to wake the dyno. */
const PING_TIMEOUT_MS = 15_000;

/** `AGORA_TOKEN_SERVICE_URL`, trailing slash trimmed. Read lazily, never at import. */
function tokenServiceBaseUrl(): string {
  const raw = process.env.AGORA_TOKEN_SERVICE_URL?.trim();
  if (!raw) throw new AgoraConfigError("AGORA_TOKEN_SERVICE_URL");
  return raw.replace(/\/+$/, "");
}

/**
 * `NEXT_PUBLIC_AGORA_APP_ID`. Public by design — the browser needs it to join —
 * but returned through this route rather than read from the client bundle, so
 * the app id and the token that authorizes it always come from one answer and
 * cannot drift apart across environments.
 */
export function agoraAppId(): string {
  const raw = process.env.NEXT_PUBLIC_AGORA_APP_ID?.trim();
  if (!raw) throw new AgoraConfigError("NEXT_PUBLIC_AGORA_APP_ID");
  return raw;
}

/**
 * An RTC token for `channel` at `role`.
 *
 * Every failure — a non-2xx, an unparseable body, a timeout, a dead host —
 * leaves as an {@link AgoraTokenServiceError} carrying a status the caller can
 * map to a clean response. Nothing here throws a raw fetch rejection.
 */
export async function fetchRtcToken(
  channel: string,
  role: AgoraRole,
): Promise<string> {
  const path = rtcTokenPath(channel, role, TOKEN_TTL_SECONDS);

  let res: Response;
  try {
    res = await fetch(`${tokenServiceBaseUrl()}${path}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    // Timeout, DNS, TLS, connection reset — the request never produced a status.
    throw new AgoraTokenServiceError(
      0,
      err instanceof Error ? err.message : String(err),
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AgoraTokenServiceError(res.status, body.slice(0, 200));
  }

  const parsed: unknown = await res.json().catch(() => null);
  const token = parseRtcTokenResponse(parsed);
  if (!token) {
    throw new AgoraTokenServiceError(res.status, "response carried no rtcToken");
  }
  return token;
}

export interface WarmPingResult {
  ok: boolean;
  /** HTTP status, or 0 when the request never completed. */
  status: number;
  durationMs: number;
}

/**
 * Wake the token service so the next real join doesn't pay the cold start
 * (SPEC §9 cold-start note, §12). Called from `cron/sweep-presence`.
 *
 * **Never throws and never fails the caller.** A sweep that couldn't reach a
 * third-party warmer has not failed at anything it is responsible for — the
 * worst case is one slow join, which `REQUEST_TIMEOUT_MS` already absorbs.
 * An unconfigured URL is reported as `ok: false` for the same reason.
 */
export async function pingTokenService(): Promise<WarmPingResult> {
  const startedAt = Date.now();
  try {
    const res = await fetch(`${tokenServiceBaseUrl()}/ping`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });
    return { ok: res.ok, status: res.status, durationMs: Date.now() - startedAt };
  } catch {
    return { ok: false, status: 0, durationMs: Date.now() - startedAt };
  }
}
