import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TUTOR_GUIDE } from "@/content/tutor-guide";
import { linksIn, parseInline } from "@/content/inline";
import { isExistingRoute } from "@/lib/routes";

/**
 * The tutor guide (`content/tutor-guide.ts`) is rendered on `/tutor/guide` and
 * printed to `public/tutor-guide.pdf`, which two emails attach by URL. So: every
 * link goes somewhere the app serves, no em dash (`reference/writing-style.md`),
 * every section can be anchored, and the PDF is actually in the repo.
 */

function allText(): string[] {
  const out = [...TUTOR_GUIDE.intro];
  for (const s of TUTOR_GUIDE.sections) {
    out.push(s.title);
    for (const b of s.blocks) {
      if (b.kind === "p" || b.kind === "note") out.push(b.text);
      else out.push(...b.items);
    }
  }
  return out;
}

describe("tutor guide content", () => {
  it("links only to routes the app serves, or to https", () => {
    const hrefs = allText().flatMap(linksIn);
    expect(hrefs.length).toBeGreaterThan(8);
    for (const href of hrefs) {
      expect(href.startsWith("https://") || isExistingRoute(href), href).toBe(true);
    }
  });

  it("has no em dash and no unfilled marker", () => {
    for (const text of allText()) {
      expect(text).not.toContain("—");
      expect(text).not.toContain("[to confirm");
    }
  });

  it("gives every section a unique anchor and a title", () => {
    const ids = TUTOR_GUIDE.sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of TUTOR_GUIDE.sections) {
      expect(s.id).toMatch(/^[a-z][a-z-]*$/);
      expect(s.title.length).toBeGreaterThan(3);
      expect(s.blocks.length).toBeGreaterThan(0);
    }
  });

  it("parses the link markup and leaves plain text alone", () => {
    expect(parseInline("Open [Bookings](/tutor/bookings) now.")).toEqual([
      { kind: "text", text: "Open " },
      { kind: "link", label: "Bookings", href: "/tutor/bookings" },
      { kind: "text", text: " now." },
    ]);
    expect(parseInline("No links here")).toEqual([{ kind: "text", text: "No links here" }]);
  });
});

describe("tutor guide PDF", () => {
  it("is built and committed (pnpm guide:pdf)", () => {
    const file = path.join(process.cwd(), "public/tutor-guide.pdf");
    expect(fs.existsSync(file), "run pnpm guide:pdf").toBe(true);
    const head = fs.readFileSync(file).subarray(0, 5).toString("latin1");
    expect(head).toBe("%PDF-");
  });
});
