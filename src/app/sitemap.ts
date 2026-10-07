import type { MetadataRoute } from "next";
import { browseTutors } from "@/db/queries/tutors";
import { parseTutorSearchParams } from "@/lib/tutors/filters";
import { buildSitemap, collectAllPages } from "@/lib/seo/sitemap-routes";
import { resolveSiteUrl } from "@/lib/seo/site-url";

// Built on request, not at `next build`: the profile list comes from the
// database, and a build must not need one (SPEC §6).
export const dynamic = "force-dynamic";

/**
 * `/sitemap.xml`: the static public routes plus one entry per approved,
 * non-suspended tutor, read through the same browse query `/tutors` renders
 * from (no filters, relevance order, every page). If the database cannot be
 * reached the sitemap still answers with the static routes.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = resolveSiteUrl().origin;
  const query = parseTutorSearchParams(new URLSearchParams());
  let tutors: { slug: string }[] = [];
  try {
    tutors = await collectAllPages(async (cursor) => {
      const { cards, nextCursor } = await browseTutors({ ...query, cursor }, { viewerId: null });
      return { items: cards.map((c) => ({ slug: c.slug })), nextCursor };
    });
  } catch (err) {
    console.warn("[sitemap] tutor profiles skipped, database unreachable:", err instanceof Error ? err.message : err);
  }
  return buildSitemap({ siteUrl, tutors });
}
