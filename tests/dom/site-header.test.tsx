import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

/**
 * The site header (design v2 Part B, DESIGN.md "Buttons" and SPEC §10.3).
 *
 * Asserted: the pill nav marks the current page; a signed-out visitor gets Log
 * in and Sign up; a signed-in one gets a link to their own role home instead;
 * the mobile menu holds the same links and the same actions, so nothing is
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

  it("marks the current page in the nav", () => {
    pathname.current = "/tutors";
    render(<SiteHeader viewer={null} />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    const current = within(nav).getByRole("link", { name: "Find tutors" });
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: "Live now" }).getAttribute("aria-current")).toBeNull();
  });

  it("links How it works to the home section and never marks an anchor as current", () => {
    pathname.current = "/";
    render(<SiteHeader viewer={null} />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    const how = within(nav).getByRole("link", { name: "How it works" });
    expect(how.getAttribute("href")).toBe("/#how");
    expect(how.getAttribute("aria-current")).toBeNull();
  });

  it("stays marked on a child route", () => {
    pathname.current = "/tutors/liam-bennett";
    render(<SiteHeader viewer={null} />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Find tutors" }).getAttribute("aria-current")).toBe("page");
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

    for (const label of ["Find tutors", "Live now", "Teach"]) {
      expect(within(dialog).getByRole("link", { name: label })).toBeTruthy();
    }
    expect(within(dialog).getByRole("link", { name: "Log in" }).getAttribute("href")).toBe("/login");
    expect(within(dialog).getByRole("link", { name: "Sign up" }).getAttribute("href")).toBe("/signup");
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
