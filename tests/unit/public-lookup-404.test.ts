import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * `/tutors/[slug]` must answer a missing tutor with a real 404 status, not a
 * 200 that merely shows the not-found view (production until 2026-10-07).
 *
 * Next sets the status when it flushes the shell. A `loading.tsx` anywhere
 * between `src/app` and the page puts the page behind a Suspense boundary, so
 * the shell leaves with a 200 before `notFound()` has run and the error can only
 * swap the spinner for the not-found view. There is no runtime hook to assert
 * on without a server, so this test pins the shape of the route tree that makes
 * the status right: the page sits in `(public-lookup)`, nothing above it
 * defines a loading file, and the group carries the same shell and error view
 * as `(public)`. See `src/app/(public-lookup)/layout.tsx`.
 */
const ROOT = join(__dirname, "..", "..");
const APP = join(ROOT, "src", "app");
const GROUP = join(APP, "(public-lookup)");
const PAGE = join(GROUP, "tutors", "[slug]", "page.tsx");

const LOADING_FILES = ["loading.tsx", "loading.ts", "loading.jsx", "loading.js"];

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

describe("/tutors/[slug] answers a missing tutor with a real 404", () => {
  it("the profile page lives in (public-lookup) and calls notFound()", () => {
    expect(existsSync(PAGE), relative(ROOT, PAGE)).toBe(true);
    const src = readFileSync(PAGE, "utf8");
    expect(src).toMatch(/import \{[^}]*\bnotFound\b[^}]*\} from "next\/navigation"/);
    expect(src).toMatch(/if \(!tutor\) notFound\(\);/);
  });

  it("no loading file sits between src/app and the page", () => {
    for (const dir of segmentDirs(PAGE)) {
      for (const name of LOADING_FILES) {
        const candidate = join(dir, name);
        expect(
          existsSync(candidate),
          `${relative(ROOT, candidate)} would put the profile behind a Suspense boundary and turn its 404 into a 200`,
        ).toBe(false);
      }
    }
  });

  it("the route is defined once: no other tutors/[slug] page under src/app", () => {
    const pages = walk(APP)
      .map((p) => relative(APP, p))
      .filter((p) => /(^|\/)tutors\/\[slug\]\/page\.(tsx|ts|jsx|js)$/.test(p));
    expect(pages).toEqual([relative(APP, PAGE)]);
  });

  it("(public-lookup) carries the site shell and the public error view", () => {
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
});
