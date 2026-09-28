/**
 * Absolute links for email bodies. Pages use the request's origin
 * (`originFromHeaders` in `actions/auth.ts`); a cron or a webhook has no
 * request origin worth trusting, so emails read `NEXT_PUBLIC_APP_URL` and
 * nothing else. Unset means the send fails with a clear message, caught and
 * logged by `send.ts`, rather than a link to the wrong host going out.
 */
export function appUrl(path = "/"): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (!base) throw new Error("NEXT_PUBLIC_APP_URL is not set, so email links cannot be built.");
  return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
}
