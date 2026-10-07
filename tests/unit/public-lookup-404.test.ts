import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * `/tutors/[slug]` and `/live/[broadcastId]` must answer a missing record with
 * a real 404 status, not a 200 that merely shows the not-found view (production
 * for the tutor profile until 2026-10-07, for the broadcast page until the
 * `fix-missing-broadcast-404` change).
 *
 * Next sets the status when it flushes the shell. A `loading.tsx` anywhere
 * between `src/app` and the page puts the page behind a Suspense boundary, so
 * the shell leaves with a 200 before `notFound()` has run and the error can only
 * swap the spinner for the not-found view. There is no runtime hook to assert
 * on without a server, so this test pins the shape of the route tree that makes
 * the status right: each page sits in `(public-lookup)`, nothing above it
 * defines a loading file, the route exists once, and the group carries the same
 * shell and error view as `(public)`. See `src/app/(public-lookup)/layout.tsx`.
 */
const ROOT = join(__dirname, "..", "..");
const APP = join(ROOT, "src", "app");
const GROUP = join(APP, "(public-lookup)");

const LOADING_FILES = ["loading.tsx", "loading.ts", "loading.jsx", "loading.js"];

/**
 * One entry per lookup page: where it lives inside the group, the `notFound()`
 * calls its source must contain, and the pattern that finds the same route
 * anywhere under `src/app` (so a second copy in another group is caught).
 */
const LOOKUP_PAGES = [
  {
    route: "/tutors/[slug]",
    page: join(GROUP, "tutors", "[slug]", "page.tsx"),
    notFoundCalls: [/if \(!tutor\) notFound\(\);/],
    routePattern: /(^|\/)tutors\/\[slug\]\/page\.(tsx|ts|jsx|js)$/,
  },
  {
    route: "/live/[broadcastId]",
    page: join(GROUP, "live", "[broadcastId]", "page.tsx"),
    notFoundCalls: [
      // A malformed id never reaches the database; a well-formed one that is
      // not a broadcast gets the same 404.
      /if \(!z\.string\(\)\.uuid\(\)\.safeParse\(broadcastId\)\.success\) notFound\(\);/,
      /if \(!broadcast\) notFound\(\);/,
    ],
    routePattern: /(^|\/)live\/\[broadcastId\]\/page\.(tsx|ts|jsx|js)$/,
  },
];

/** `src/app`, then every directory down to (and including) the one holding `file`. */
function segmentDirs(file: string) {
  const parts = relative(APP, file).split(sep).slice(0, -1);
  const dirs = [APP];
  for (const part of parts) dirs.push(join(dirs[dirs.length - 1], part));
  return dirs;
}

function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe.each(LOOKUP_PAGES)("$route answers a missing record with a real 404", ({ page, notFoundCalls, routePattern }) => {
  it("the page lives in (public-lookup) and calls notFound()", () => {
    expect(existsSync(page), relative(ROOT, page)).toBe(true);
    const src = readFileSync(page, "utf8");
    expect(src).toMatch(/import \{[^}]*\bnotFound\b[^}]*\} from "next\/navigation"/);
    for (const call of notFoundCalls) expect(src).toMatch(call);
  });

  it("no loading file sits between src/app and the page", () => {
    for (const dir of segmentDirs(page)) {
      for (const name of LOADING_FILES) {
        const candidate = join(dir, name);
        expect(
          existsSync(candidate),
          `${relative(ROOT, candidate)} would put the page behind a Suspense boundary and turn its 404 into a 200`,
        ).toBe(false);
      }
    }
  });

  it("the route is defined once under src/app", () => {
    const pages = walk(APP)
      .map((p) => relative(APP, p))
      .filter((p) => routePattern.test(p));
    expect(pages).toEqual([relative(APP, page)]);
  });
});

describe("(public-lookup) route group", () => {
  it("carries the site shell and the public error view", () => {
    const layout = readFileSync(join(GROUP, "layout.tsx"), "utf8");
    expect(layout).toContain('from "@/components/layout/site-shell"');
    expect(layout).toMatch(/<SiteShell>\{children\}<\/SiteShell>/);

    const error = readFileSync(join(GROUP, "error.tsx"), "utf8");
    const publicError = readFileSync(join(APP, "(public)", "error.tsx"), "utf8");
    expect(error.startsWith('"use client";')).toBe(true);
    // Same message and same way home as the sibling group, so a visitor cannot
    // tell the two groups apart when something breaks.
    for (const line of publicError.split("\n").filter((l) => /message=|home=/.test(l))) {
      expect(error).toContain(line.trim());
    }
  });

  it("the /live index stays in (public), where its loading ring is harmless", () => {
    // `/live` lists broadcasts and never calls notFound(), so it keeps the
    // instant loading state. Only the per-broadcast page moved.
    expect(existsSync(join(APP, "(public)", "live", "page.tsx"))).toBe(true);
    expect(existsSync(join(GROUP, "live", "page.tsx"))).toBe(false);
  });
});
