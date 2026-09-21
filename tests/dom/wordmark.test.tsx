import * as React from "react";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Wordmark, WORDMARK_SRC } from "@/components/layout/wordmark";
import { WORDMARK_VIEWBOX } from "@/components/layout/wordmark-paths";

/**
 * The logo (performance review P4).
 *
 * The outline is a 34 KB path. Inline, it shipped four times in every page's
 * HTML (header and footer, each once as markup and once in the React payload),
 * about 136 KB of a 167 KB login page, and no page is cacheable. Asserted: the
 * markup is small, it points at one static file, that file is the logo, and
 * the accessible names are what they were.
 */

describe("Wordmark", () => {
  it("adds almost nothing to the page", () => {
    const { container } = render(<Wordmark href="/" size="sm" />);
    expect(container.innerHTML.length).toBeLessThan(1000);
  });

  it("is painted from the one static file, in the current text colour", () => {
    const { container } = render(<Wordmark />);
    const mark = container.querySelector("[data-wordmark]") as HTMLElement;
    expect(mark).toBeTruthy();
    expect(mark.style.maskImage).toContain(WORDMARK_SRC);
    expect(mark.className).toContain("bg-current");
  });

  it("keeps its names: an image on its own, a home link when it links", () => {
    const { unmount } = render(<Wordmark />);
    expect(screen.getByRole("img", { name: "NowTutors" })).toBeTruthy();
    unmount();

    render(<Wordmark href="/" />);
    expect(screen.getByRole("link", { name: "NowTutors home" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: "NowTutors" })).toBeNull();
  });

  it("the static file is the logo: same viewBox, one even-odd path", () => {
    const file = resolve(process.cwd(), "public", WORDMARK_SRC.replace(/^\//, ""));
    expect(existsSync(file)).toBe(true);
    const svg = readFileSync(file, "utf8");
    expect(svg).toContain(`viewBox="${WORDMARK_VIEWBOX}"`);
    expect(svg.match(/<path /g)?.length).toBe(1);
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).toContain('d="M798.8 175.6 ');
  });
});
