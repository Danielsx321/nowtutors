import type { MetadataRoute } from "next";

/**
 * The public routes worth a sitemap entry: everything under `(public)` that is
 * not a dynamic segment, plus the two entry doors. Forgot/reset password are
 * real routes but not pages anyone should land on from a search result. Every
 * entry must also be in `lib/routes.ts` (the sitemap test enforces it).
 */
export const SITEMAP_STATIC_ROUTES = [
  "/",
  "/tutors",
  "/live",
  "/legal/terms",
  "/legal/privacy",
  "/legal/refunds",
  "/login",
  "/signup",
] as const;

export interface SitemapTutor {
  slug: string;
  updatedAt?: Date | null;
}

export function buildSitemap(opts: { siteUrl: string; tutors: SitemapTutor[] }): MetadataRoute.Sitemap {
  const base = opts.siteUrl.replace(/\/+$/, "");
  const statics: MetadataRoute.Sitemap = SITEMAP_STATIC_ROUTES.map((path) => ({
    url: path === "/" ? `${base}/` : `${base}${path}`,
  }));
  const seen = new Set<string>();
  const profiles: MetadataRoute.Sitemap = [];
  for (const t of opts.tutors) {
    if (!t.slug || seen.has(t.slug)) continue;
    seen.add(t.slug);
    profiles.push({
      url: `${base}/tutors/${encodeURIComponent(t.slug)}`,
      ...(t.updatedAt ? { lastModified: t.updatedAt } : {}),
    });
  }
  return [...statics, ...profiles];
}

/** How many browse pages the sitemap will walk before stopping (24 per page). */
export const SITEMAP_MAX_PAGES = 50;

/**
 * Walk a keyset-paginated list to the end. `fetchPage` is the existing browse
 * query with its cursor; the cap keeps a runaway cursor from looping forever.
 */
export async function collectAllPages<T>(
  fetchPage: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | null }>,
  maxPages = SITEMAP_MAX_PAGES,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const { items, nextCursor } = await fetchPage(cursor);
    out.push(...items);
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }
  return out;
}
