import "server-only";
import { PayPalConfigError } from "./config-error";

/**
 * The one PayPal integration (SPEC §7.6). Everything that talks to PayPal goes
 * through here: base URL, OAuth access token, and a thin typed fetch.
 *
 * Sandbox vs live is switched by `PAYPAL_ENV` alone — neither host is ever
 * hardcoded at a call site, so promoting to live is an env change, not a code
 * change. The client secret is read lazily inside the request path (never at
 * module load) so importing this file in a build or a test that never calls
 * PayPal doesn't require credentials.
 *
 * No PayPal SDK dependency: the REST API is three endpoints and SPEC §2 pins the
 * dependency list (CLAUDE.md — no unlisted deps).
 */

const HOSTS = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
} as const;

export type PayPalEnv = keyof typeof HOSTS;

/** `PAYPAL_ENV`, defaulting to sandbox. Anything but "live" is sandbox — a typo
 *  must never silently point a dev build at real money. */
export function paypalEnv(): PayPalEnv {
  return process.env.PAYPAL_ENV?.trim().toLowerCase() === "live"
    ? "live"
    : "sandbox";
}

/** The API base for the configured environment. The only place a host appears. */
export function paypalBaseUrl(): string {
  return HOSTS[paypalEnv()];
}

/** Raised when PayPal returns a non-2xx. Carries the status and body for logs. */
export class PayPalApiError extends Error {
  readonly code = "paypal_api_error" as const;
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: unknown,
  ) {
    super(`PayPal ${path} failed with ${status}`);
    this.name = "PayPalApiError";
  }
}

// Re-exported from a `server-only`-free module so the route-adapter config
// boundary (and its test) can reach the class without importing this file.
export { PayPalConfigError, isPayPalConfigError } from "./config-error";

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new PayPalConfigError(name);
  return v;
}

interface CachedToken {
  token: string;
  /** Epoch ms after which the token is treated as expired. */
  expiresAt: number;
  /** The env+client the token was minted for; a change invalidates the cache. */
  key: string;
}

let cached: CachedToken | null = null;

/** Refresh this many ms before PayPal's stated expiry, so a token can't lapse
 *  mid-flight on a slow request. PayPal tokens last ~9 hours. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * A client-credentials access token, cached in module scope until shortly before
 * it expires. The cache key includes the environment and client id so a
 * sandbox→live switch (or a rotated key) can never reuse the previous token.
 */
export async function getAccessToken(): Promise<string> {
  const clientId = requireEnv("PAYPAL_CLIENT_ID");
  const secret = requireEnv("PAYPAL_CLIENT_SECRET");
  const key = `${paypalEnv()}:${clientId}`;

  if (cached && cached.key === key && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const basic = Buffer.from(`${clientId}:${secret}`).toString("base64");
  const res = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    cached = null;
    throw new PayPalApiError(res.status, "/v1/oauth2/token", body);
  }

  const parsed = body as { access_token?: unknown; expires_in?: unknown };
  if (typeof parsed?.access_token !== "string") {
    throw new PayPalApiError(res.status, "/v1/oauth2/token", body);
  }
  const expiresInSec =
    typeof parsed.expires_in === "number" && Number.isFinite(parsed.expires_in)
      ? parsed.expires_in
      : 300;

  cached = {
    token: parsed.access_token,
    expiresAt: Date.now() + Math.max(expiresInSec * 1000 - EXPIRY_SKEW_MS, 0),
    key,
  };
  return cached.token;
}

/** Drop the cached token. Used by tests and after a 401 from PayPal. */
export function clearAccessTokenCache(): void {
  cached = null;
}

interface PayPalRequest {
  method?: "GET" | "POST";
  body?: unknown;
  /** PayPal's idempotency header; set on every mutating call. */
  requestId?: string;
}

/**
 * Authenticated call against the configured PayPal API. Retries exactly once on
 * a 401 with a fresh token (the cached one can go stale if credentials are
 * rotated) and otherwise throws {@link PayPalApiError}.
 */
export async function paypalFetch<T>(
  path: string,
  { method = "POST", body, requestId }: PayPalRequest = {},
): Promise<T> {
  const send = async (token: string) =>
    fetch(`${paypalBaseUrl()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });

  let res = await send(await getAccessToken());
  if (res.status === 401) {
    clearAccessTokenCache();
    res = await send(await getAccessToken());
  }

  const parsed: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new PayPalApiError(res.status, path, parsed);
  return parsed as T;
}
