import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

/**
 * The site footer (design v2 Part B, DESIGN.md "Tokens / dark islands" and
 * SPEC §10.3).
 *
 * Asserted: every column renders; **every link points at a route the app
 * actually serves**, which is the rule broken twice before this file existed;
 * the live count reads the real number and says so plainly when nobody is live;
 * the Dashboard link appears only for a signed-in viewer.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { SiteFooter } from "@/components/layout/site-footer";
import { isExistingRoute } from "@/lib/routes";

describe("SiteFooter", () => {
  it("links only to routes that exist (SPEC §10.3)", () => {
    render(<SiteFooter liveCount={4} viewerHome="/dashboard" />);
    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.length).toBeGreaterThan(5);
    const missing = hrefs.filter((h) => !isExistingRoute(h));
    expect(missing).toEqual([]);
  });

  it("renders every column", () => {
    render(<SiteFooter liveCount={0} />);
    for (const heading of ["Learn", "Teach", "Account", "Trust"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    }
    const learn = screen.getByRole("navigation", { name: "Learn" });
    expect(within(learn).getByRole("link", { name: "Find tutors" }).getAttribute("href")).toBe("/tutors");
    expect(within(learn).getByRole("link", { name: "Live now" }).getAttribute("href")).toBe("/live");
  });

  it("shows the real live count", () => {
    render(<SiteFooter liveCount={12} />);
    expect(screen.getByText("12 tutors live right now")).toBeTruthy();
  });

  it("says one tutor rather than 1 tutors", () => {
    render(<SiteFooter liveCount={1} />);
    expect(screen.getByText("1 tutor live right now")).toBeTruthy();
  });

  it("says nobody is live at zero, without a live dot", () => {
    const { container } = render(<SiteFooter liveCount={0} />);
    expect(screen.getByText("No tutors live right now")).toBeTruthy();
    expect(container.querySelector(".bg-live")).toBeNull();
  });

  it("offers Dashboard only to a signed-in viewer", () => {
    const { unmount } = render(<SiteFooter liveCount={2} />);
    expect(screen.queryByRole("link", { name: "Dashboard" })).toBeNull();
    unmount();

    render(<SiteFooter liveCount={2} viewerHome="/tutor" />);
    expect(screen.getByRole("link", { name: "Dashboard" }).getAttribute("href")).toBe("/tutor");
  });

  it("carries the trust pair as text", () => {
    render(<SiteFooter liveCount={0} />);
    expect(screen.getByText("No-show promise")).toBeTruthy();
    expect(screen.getByText("Secure payment via PayPal")).toBeTruthy();
  });
});
