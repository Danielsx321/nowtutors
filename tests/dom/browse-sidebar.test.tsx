import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

/**
 * The browse sidebar (design round 3 Part C, DESIGN.md v3 "Public pages").
 *
 * Asserted: it is one navigation named "Filters"; a subject click writes
 * `subject=` and drops `cursor`; a second click clears it; Live now writes
 * `live=1` and clears it again; a price band is a single choice; the selected
 * subject is marked current.
 */

const nav = vi.hoisted(() => ({ push: vi.fn(), search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
  usePathname: () => "/tutors",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import { BrowseSidebar } from "@/components/features/browse/browse-sidebar";

const subjects = [
  { slug: "algebra", name: "Algebra", tutors: 12 },
  { slug: "physics", name: "Physics", tutors: 4 },
];

describe("BrowseSidebar", () => {
  beforeEach(() => {
    nav.push.mockReset();
    nav.search = "";
  });

  it("is a navigation named Filters with the subject counts", () => {
    render(<BrowseSidebar subjects={subjects} />);
    const side = screen.getByRole("navigation", { name: "Filters" });
    expect(within(side).getByRole("button", { name: /Algebra\s*12/ })).toBeTruthy();
    expect(within(side).getByRole("button", { name: "All subjects" }).getAttribute("aria-current")).toBe("true");
  });

  it("a subject click writes subject= and drops the cursor", () => {
    nav.search = "cursor=abc&sort=price_asc";
    render(<BrowseSidebar subjects={subjects} />);
    fireEvent.click(screen.getByRole("button", { name: /Algebra/ }));
    expect(nav.push).toHaveBeenCalledWith("/tutors?sort=price_asc&subject=algebra", { scroll: false });
  });

  it("a selected subject is current, and a second click clears it", () => {
    nav.search = "subject=algebra";
    render(<BrowseSidebar subjects={subjects} />);
    const algebra = screen.getByRole("button", { name: /Algebra/ });
    expect(algebra.getAttribute("aria-current")).toBe("true");
    fireEvent.click(algebra);
    expect(nav.push).toHaveBeenCalledWith("/tutors", { scroll: false });
  });

  it("Live now writes live=1 and clears it again", () => {
    render(<BrowseSidebar subjects={subjects} />);
    fireEvent.click(screen.getByRole("switch", { name: "Live now" }));
    expect(nav.push).toHaveBeenLastCalledWith("/tutors?live=1", { scroll: false });
  });

  it("a price band is one choice, pressed when selected", () => {
    nav.search = "price=50_100";
    render(<BrowseSidebar subjects={subjects} />);
    const band = screen.getByRole("button", { name: "50–100 credits/hr" });
    expect(band.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Under 50 credits/hr" }));
    expect(nav.push).toHaveBeenLastCalledWith("/tutors?price=under_50", { scroll: false });
  });

  it("a language checkbox writes lang=", () => {
    render(<BrowseSidebar subjects={subjects} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Spanish" }));
    expect(nav.push).toHaveBeenLastCalledWith("/tutors?lang=Spanish", { scroll: false });
  });
});
