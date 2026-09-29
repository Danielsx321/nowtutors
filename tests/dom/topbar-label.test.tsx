import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * The avatar button's accessible name starts with the name it shows, so voice
 * control ("click Elizabeth") and screen readers agree (Lighthouse
 * label-content-name-mismatch, Phase 10 Part 5).
 */
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/actions/auth", () => ({ signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: vi.fn(() => "/"), useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/features/messaging/unread-messages-link", () => ({ UnreadMessagesLink: () => null }));
vi.mock("@/components/features/tutor/go-live-toggle", () => ({ GoLiveToggle: () => null }));

import { Topbar } from "@/components/layout/topbar";

describe("Topbar account menu", () => {
  it("is named after the person, then what it does", () => {
    render(<Topbar userName="Elizabeth" />);
    const button = screen.getByRole("button", { name: "Elizabeth, account menu" });
    expect(button.textContent).toContain("Elizabeth");
  });
});

describe("Topbar section tabs", () => {
  it("lists the area's four main sections and underlines the current one", async () => {
    const nav = await import("next/navigation");
    vi.spyOn(nav, "usePathname").mockReturnValue("/tutor/bookings/abc");
    render(<Topbar role="tutor" userName="Elizabeth" />);
    const tabs = screen.getByRole("navigation", { name: "Sections" });
    const links = Array.from(tabs.querySelectorAll("a"));
    expect(links.map((a) => a.textContent)).toEqual(["Today", "Bookings", "Messages", "Earnings"]);
    const current = links.filter((a) => a.getAttribute("aria-current") === "page").map((a) => a.textContent);
    expect(current).toEqual(["Bookings"]);
  });

  it("is a navy island, so its controls read on the dark bar", () => {
    const { container } = render(<Topbar userName="Sam" />);
    expect(container.querySelector("header")?.className).toContain("theme-dark");
  });
});
