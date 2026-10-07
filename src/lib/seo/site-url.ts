/**
 * The site's public origin, for metadata, robots and the sitemap.
 *
 * Order: `NEXT_PUBLIC_APP_URL` (what the launch cutover sets to
 * `https://nowtutors.com`), then the deployment's own `VERCEL_URL` (previews,
 * and production until the env var changes), then localhost for a bare build.
 * Emails keep their own stricter rule (`lib/email/app-url.ts` throws when the
 * variable is unset) because a wrong link in an email goes out; a wrong
 * metadata origin on a preview does not.
 */
export type SiteUrlEnv = Record<string, string | undefined>;

export const LOCAL_SITE_URL = "http://localhost:3000";

export function resolveSiteUrl(env: SiteUrlEnv = process.env): URL {
  const configured = env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return new URL(configured);
  const vercel = env.VERCEL_URL?.trim();
  if (vercel) return new URL(`https://${vercel.replace(/^https?:\/\//, "")}`);
  return new URL(LOCAL_SITE_URL);
}
