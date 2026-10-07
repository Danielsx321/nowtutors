import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  buildHostRedirects,
  CANONICAL_ORIGIN,
  REDIRECT_SOURCE,
  VERCEL_HOST,
  WWW_HOST,
} from "@/lib/seo/redirects";

// The same matcher Next compiles `redirects()` sources with, so the exemption
// is tested against the real thing rather than a hand-written regex.
const { pathToRegexp } = createRequire(import.meta.url)("next/dist/compiled/path-to-regexp") as {
  pathToRegexp: (source: string) => RegExp;
};

describe("buildHostRedirects (domain switch, next.config.ts)", () => {
  it("adds nothing outside production", () => {
    expect(buildHostRedirects({})).toEqual([]);
    expect(buildHostRedirects({ VERCEL_ENV: "preview", LAUNCH_REDIRECT_VERCEL_HOST: "1" })).toEqual([]);
    expect(buildHostRedirects({ VERCEL_ENV: "development", LAUNCH_REDIRECT_VERCEL_HOST: "1" })).toEqual([]);
  });

  it("folds www into the bare domain in production, permanently, by host", () => {
    const list = buildHostRedirects({ VERCEL_ENV: "production" });
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({
      source: REDIRECT_SOURCE,
      destination: `${CANONICAL_ORIGIN}/:path`,
      permanent: true,
      has: [{ type: "host", value: WWW_HOST }],
    });
  });

  it("redirects the old vercel.app host only when LAUNCH_REDIRECT_VERCEL_HOST=1", () => {
    const off = buildHostRedirects({ VERCEL_ENV: "production", LAUNCH_REDIRECT_VERCEL_HOST: "" });
    expect(off.map((r) => r.has[0].value)).toEqual([WWW_HOST]);
    const wrong = buildHostRedirects({ VERCEL_ENV: "production", LAUNCH_REDIRECT_VERCEL_HOST: "true" });
    expect(wrong.map((r) => r.has[0].value)).toEqual([WWW_HOST]);
    const on = buildHostRedirects({ VERCEL_ENV: "production", LAUNCH_REDIRECT_VERCEL_HOST: "1" });
    expect(on.map((r) => r.has[0].value)).toEqual([WWW_HOST, VERCEL_HOST]);
    expect(on[1].destination).toBe(`${CANONICAL_ORIGIN}/:path`);
    expect(on[1].permanent).toBe(true);
  });

  it("matches every page but leaves webhook and cron paths alone", () => {
    const re = pathToRegexp(REDIRECT_SOURCE);
    for (const p of ["/", "/tutors", "/tutors/ann-lee", "/login", "/api/agora/token", "/api/paypal/orders"]) {
      expect(re.test(p), p).toBe(true);
    }
    for (const p of ["/api/webhooks/paypal", "/api/cron/sweep-presence", "/api/cron/release-earnings"]) {
      expect(re.test(p), p).toBe(false);
    }
  });

  it("carries the whole path into the destination", () => {
    const re = pathToRegexp(REDIRECT_SOURCE);
    expect(re.exec("/tutors/ann-lee")?.[1]).toBe("tutors/ann-lee");
    expect(re.exec("/")?.[1]).toBe("");
  });
});
