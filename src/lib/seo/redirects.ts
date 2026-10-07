/**
 * Host redirects for the domain switch, pure so `next.config.ts` can import
 * them and a unit test can read them without Next.
 *
 * Two hosts fold into `https://nowtutors.com`:
 * - `www.nowtutors.com`, always in production (nothing serves www today, so
 *   the rule has no effect until DNS points www at Vercel);
 * - `nowtutors-brown.vercel.app`, only when `LAUNCH_REDIRECT_VERCEL_HOST=1`.
 *   The flag is an env var rather than a deploy so the old host keeps working
 *   through the cutover and is switched off in one place when the domain is
 *   proven (DECISIONS, 2026-10-07).
 *
 * `/api/webhooks/*` and `/api/cron/*` are exempt from both: PayPal and pg_cron
 * post to whichever host they were configured with, and a 308 would turn a
 * POST into a retry storm against a host that has not been re-pointed yet.
 */
export const CANONICAL_ORIGIN = "https://nowtutors.com";
export const WWW_HOST = "www.nowtutors.com";
export const VERCEL_HOST = "nowtutors-brown.vercel.app";

/** Path params with a negative lookahead: everything except the machine routes. */
export const REDIRECT_SOURCE = "/:path((?!api/webhooks/|api/cron/).*)";

export interface HostRedirect {
  source: string;
  destination: string;
  permanent: boolean;
  has: Array<{ type: "host"; value: string }>;
}

export type RedirectEnv = Record<string, string | undefined>;

export function buildHostRedirects(env: RedirectEnv = process.env): HostRedirect[] {
  if (env.VERCEL_ENV !== "production") return [];
  const toCanonical = (host: string): HostRedirect => ({
    source: REDIRECT_SOURCE,
    destination: `${CANONICAL_ORIGIN}/:path`,
    permanent: true,
    has: [{ type: "host", value: host }],
  });
  const redirects = [toCanonical(WWW_HOST)];
  if (env.LAUNCH_REDIRECT_VERCEL_HOST === "1") redirects.push(toCanonical(VERCEL_HOST));
  return redirects;
}
