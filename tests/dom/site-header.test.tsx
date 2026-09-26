import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

/**
 * The site header (design round 3 Part B, DESIGN.md v3 and SPEC §10.3).
 *
 * Asserted: the nav marks the current page; a signed-out visitor gets Log in
 * and Sign up; a signed-in one gets a link to their own role home instead;
 * the subject search shows on browse and submits to /tutors?q=; the mobile
 * menu holds the same links, the search and the same actions, so nothing is
 * reachable at one width only; every href is a route that exists.
 */

const pathname = vi.hoisted(() => ({ current: "/" }));

vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} />,
}));

import { SiteHeader } from "@/components/layout/site-header";
import { isExistingRoute } from "@/lib/routes";

describe("SiteHeader", () => {
  it("offers Log in and Sign up when signed out", () => {
    pathname.current = "/";
    render(<SiteHeader viewer={null} />);
    expect(screen.getByRole("link", { name: "Log in" }).getAttribute("href")).toBe("/login");
    expect(screen.getByRole("link", { name: "Sign up" }).getAttribute("href")).toBe("/signup");
  });

  it("marks All tutors as current on browse, never the live link", () => {
    pathname.current = "/tutors";
    render(<SiteHeader viewer={null} />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "All tutors" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: "Live tutors" }).getAttribute("aria-current")).toBeNull();
    expect(within(nav).getByRole("link", { name: "Live tutors" }).getAttribute("href")).toBe("/tutors?live=1");
  });

  it("stays marked on a child route", () => {
    pathname.current = "/tutors/liam-bennett";
    render(<SiteHeader viewer={null} />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "All tutors" }).getAttribute("aria-current")).toBe("page");
  });

  it("shows the subject search on browse only, submitting to /tutors?q=", () => {
    pathname.current = "/tutors";
    const { unmount } = render(<SiteHeader viewer={null} />);
    const form = screen.getAllByRole("search")[0];
    expect(form.getAttribute("action")).toBe("/tutors");
    expect(within(form).getByRole("searchbox", { name: "Search subjects" }).getAttribute("name")).toBe("q");
    unmount();

    pathname.current = "/";
    render(<SiteHeader viewer={null} />);
    // Home carries its own search band; the drawer (closed) holds the only other form.
    expect(screen.queryAllByRole("search")).toEqual([]);
  });

  it("sends a signed-in tutor to their own home", () => {
    pathname.current = "/";
    render(
      <SiteHeader viewer={{ home: "/tutor", displayName: "Amara Okafor", avatarUrl: null }} />,
    );
    expect(screen.getByRole("link", { name: /Dashboard/ }).getAttribute("href")).toBe("/tutor");
    expect(screen.queryByRole("link", { name: "Log in" })).toBeNull();
  });

  it("holds the same links and actions in the mobile menu", async () => {
    pathname.current = "/";
    render(<SiteHeader viewer={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const dialog = await screen.findByRole("dialog");

    for (const label of ["Live tutors", "All tutors"]) {
      expect(within(dialog).getByRole("link", { name: label })).toBeTruthy();
    }
    expect(within(dialog).getByRole("link", { name: "Log in" }).getAttribute("href")).toBe("/login");
    expect(within(dialog).getByRole("link", { name: "Sign up" }).getAttribute("href")).toBe("/signup");
    expect(within(dialog).getByRole("searchbox", { name: "Search subjects" })).toBeTruthy();
  });

  it("links only to routes that exist (SPEC §10.3)", () => {
    pathname.current = "/";
    render(<SiteHeader viewer={null} />);
    const missing = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href") ?? "")
      .filter((h) => !isExistingRoute(h));
    expect(missing).toEqual([]);
  });
});
