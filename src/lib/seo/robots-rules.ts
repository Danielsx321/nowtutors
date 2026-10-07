import type { MetadataRoute } from "next";

/**
 * robots.txt rules, pure so they can be tested without Next.
 *
 * Only the production deployment invites crawlers. Previews and the
 * `vercel.app` host before the domain switch disallow everything, so a copy of
 * the site never competes with `nowtutors.com` in search results.
 *
 * Disallowed prefixes are the signed-in and machine routes (SPEC §6). robots
 * matching is by prefix, so `/tutor` alone would also block the public
 * `/tutors` browse and every profile; the tutor app is listed as `/tutor/` and
 * `/tutor$` instead.
 */
export const PRIVATE_PATH_RULES = [
  "/admin",
  "/dashboard",
  "/tutor/",
  "/tutor$",
  "/onboarding",
  "/api",
  "/auth",
  "/dev",
  "/session",
  "/classroom",
  "/broadcast",
  "/suspended",
] as const;

export function buildRobots(opts: { isProduction: boolean; siteUrl: string }): MetadataRoute.Robots {
  const base = opts.siteUrl.replace(/\/+$/, "");
  if (!opts.isProduction) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: { userAgent: "*", allow: "/", disallow: [...PRIVATE_PATH_RULES] },
    sitemap: `${base}/sitemap.xml`,
  };
}
