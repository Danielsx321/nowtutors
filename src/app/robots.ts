import type { MetadataRoute } from "next";
import { buildRobots } from "@/lib/seo/robots-rules";
import { resolveSiteUrl } from "@/lib/seo/site-url";

/**
 * `/robots.txt`. Production (`VERCEL_ENV=production`) allows crawling outside
 * the signed-in and machine routes and points at the sitemap; every other
 * deployment, previews included, disallows everything (SPEC §6).
 */
export default function robots(): MetadataRoute.Robots {
  return buildRobots({
    isProduction: process.env.VERCEL_ENV === "production",
    siteUrl: resolveSiteUrl().origin,
  });
}
