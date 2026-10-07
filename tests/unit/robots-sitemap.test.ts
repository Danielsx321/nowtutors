import { describe, expect, it } from "vitest";
import { isExistingRoute } from "@/lib/routes";
import { buildRobots, PRIVATE_PATH_RULES } from "@/lib/seo/robots-rules";
import { resolveSiteUrl } from "@/lib/seo/site-url";
import {
  buildSitemap,
  collectAllPages,
  SITEMAP_MAX_PAGES,
  SITEMAP_STATIC_ROUTES,
} from "@/lib/seo/sitemap-routes";

describe("resolveSiteUrl (metadataBase, robots and sitemap origin)", () => {
  it("prefers NEXT_PUBLIC_APP_URL and strips a trailing slash", () => {
    expect(resolveSiteUrl({ NEXT_PUBLIC_APP_URL: "https://nowtutors.com/" }).origin).toBe(
      "https://nowtutors.com",
    );
  });

  it("falls back to the deployment's own host", () => {
    expect(resolveSiteUrl({ VERCEL_URL: "nowtutors-brown.vercel.app" }).origin).toBe(
      "https://nowtutors-brown.vercel.app",
    );
    expect(resolveSiteUrl({ NEXT_PUBLIC_APP_URL: "  ", VERCEL_URL: "x.vercel.app" }).origin).toBe(
      "https://x.vercel.app",
    );
  });

  it("falls back to localhost for a bare build", () => {
    expect(resolveSiteUrl({}).origin).toBe("http://localhost:3000");
  });
});

describe("buildRobots", () => {
  it("disallows everything outside production (previews, the old host before the switch)", () => {
    const r = buildRobots({ isProduction: false, siteUrl: "https://nowtutors-brown.vercel.app" });
    expect(r.rules).toEqual({ userAgent: "*", disallow: "/" });
    expect(r.sitemap).toBeUndefined();
  });

  it("allows the public site and blocks the signed-in and machine routes in production", () => {
    const r = buildRobots({ isProduction: true, siteUrl: "https://nowtutors.com/" });
    const rules = r.rules as { userAgent: string; allow: string; disallow: string[] };
    expect(rules.allow).toBe("/");
    for (const p of ["/admin", "/dashboard", "/onboarding", "/api", "/auth", "/dev"]) {
      expect(rules.disallow).toContain(p);
    }
    expect(r.sitemap).toBe("https://nowtutors.com/sitemap.xml");
  });

  it("never blocks the public /tutors routes with the tutor-app rule", () => {
    // robots matching is by prefix: a bare "/tutor" would also hide /tutors and every profile.
    expect(PRIVATE_PATH_RULES).not.toContain("/tutor");
    expect(PRIVATE_PATH_RULES).toContain("/tutor/");
    expect(PRIVATE_PATH_RULES).toContain("/tutor$");
    const prefixes = PRIVATE_PATH_RULES.filter((p) => !p.endsWith("$"));
    for (const pub of ["/tutors", "/tutors/ann-lee", "/live", "/legal/terms", "/login", "/signup", "/"]) {
      expect(prefixes.some((p) => pub.startsWith(p))).toBe(false);
    }
  });
});

describe("buildSitemap", () => {
  it("lists only routes the app serves", () => {
    for (const path of SITEMAP_STATIC_ROUTES) expect(isExistingRoute(path)).toBe(true);
  });

  it("covers the public pages and the two entry doors", () => {
    expect(SITEMAP_STATIC_ROUTES).toEqual(
      expect.arrayContaining(["/", "/tutors", "/live", "/legal/terms", "/legal/privacy", "/legal/refunds", "/login", "/signup"]),
    );
    const urls = buildSitemap({ siteUrl: "https://nowtutors.com", tutors: [] }).map((e) => e.url);
    expect(urls[0]).toBe("https://nowtutors.com/");
    expect(urls).toContain("https://nowtutors.com/tutors");
    expect(urls).toHaveLength(SITEMAP_STATIC_ROUTES.length);
  });

  it("adds a profile URL per tutor, deduplicated, with lastModified where known", () => {
    const when = new Date("2026-10-01T10:00:00Z");
    const entries = buildSitemap({
      siteUrl: "https://nowtutors.com/",
      tutors: [{ slug: "ann-lee", updatedAt: when }, { slug: "ann-lee" }, { slug: "tom-k" }, { slug: "" }],
    });
    const profiles = entries.filter((e) => e.url.includes("/tutors/"));
    expect(profiles).toEqual([
      { url: "https://nowtutors.com/tutors/ann-lee", lastModified: when },
      { url: "https://nowtutors.com/tutors/tom-k" },
    ]);
  });

  it("keeps working on the fallback origin when nothing is configured", () => {
    const urls = buildSitemap({ siteUrl: resolveSiteUrl({}).origin, tutors: [] }).map((e) => e.url);
    expect(urls[0]).toBe("http://localhost:3000/");
  });
});

describe("collectAllPages (walks the existing browse query to the end)", () => {
  it("follows the cursor until the last page", async () => {
    const pages: Record<string, { items: string[]; nextCursor: string | null }> = {
      start: { items: ["a", "b"], nextCursor: "c2" },
      c2: { items: ["c"], nextCursor: "c3" },
      c3: { items: ["d"], nextCursor: null },
    };
    const calls: Array<string | undefined> = [];
    const all = await collectAllPages(async (cursor) => {
      calls.push(cursor);
      return pages[cursor ?? "start"];
    });
    expect(all).toEqual(["a", "b", "c", "d"]);
    expect(calls).toEqual([undefined, "c2", "c3"]);
  });

  it("stops at the page cap and on a cursor that does not advance", async () => {
    let n = 0;
    const capped = await collectAllPages(async () => ({ items: [n++], nextCursor: `c${n}` }), 3);
    expect(capped).toEqual([0, 1, 2]);
    const stuck = await collectAllPages(async () => ({ items: ["x"], nextCursor: "same" }));
    expect(stuck).toEqual(["x", "x"]);
    expect(SITEMAP_MAX_PAGES).toBeGreaterThan(10);
  });

  it("lets a database failure surface to the caller, who falls back to static routes", async () => {
    await expect(collectAllPages(async () => { throw new Error("ECONNREFUSED"); })).rejects.toThrow("ECONNREFUSED");
  });
});
