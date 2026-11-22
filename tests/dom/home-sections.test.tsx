import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

/**
 * Home after the audit of 18 Nov 2026: How it works and the student values
 * are back on the page, and the search band carries the How it works jump
 * and the Become a tutor line.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { Steps } from "@/components/features/home/steps";
import { Values } from "@/components/features/home/values";
import { SearchBand } from "@/components/features/browse/search-band";

describe("home sections", () => {
  it("renders How it works as the #how-it-works target with three steps", () => {
    const { container } = render(<Steps />);
    const section = container.querySelector("#how-it-works");
    expect(section).not.toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "How it works" })).toBeTruthy();
    expect(within(section as HTMLElement).getAllByRole("listitem")).toHaveLength(3);
  });

  it("states the values without a 24/7 claim", () => {
    const { container } = render(<Values />);
    expect(screen.getByRole("heading", { level: 2, name: "Built for students" })).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(container.textContent).not.toMatch(/24\s*\/\s*7/);
  });

  it("puts extra content under the band's search and keeps one h1", () => {
    render(
      <SearchBand id="t" heading="Heading" subline="Sub" subjects={[]}>
        <a href="#how-it-works">How it works</a>
      </SearchBand>,
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "How it works" }).getAttribute("href")).toBe("#how-it-works");
  });
});
