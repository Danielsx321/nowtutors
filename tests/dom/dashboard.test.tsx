import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

/**
 * The v2 app shell and dashboard pieces (live-globe rebuild Part E).
 *
 * Asserted: the bar chart reads every value in its accessible label, marks the
 * current period, draws no bar for zero and puts round numbers on its axis;
 * the sidebar marks the current page as a teal pill, carries the unread count
 * in the Messages link's name without taking the topbar's test id, lists the
 * people section and ends with Log out; the people list gives one action per
 * row and a live dot only to live people.
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard/bookings" }));
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
vi.mock("@/actions/auth", () => ({ signOut: vi.fn() }));
vi.mock("@/components/features/messaging/unread-context", () => ({
  useSharedUnreadCount: () => 2,
}));

import { BarChart, niceMax } from "@/components/features/dashboard/bar-chart";
import { SidebarNav, SidebarAccount } from "@/components/layout/sidebar";
import { PeopleList } from "@/components/features/dashboard/people-list";
import { studentNav } from "@/components/layout/nav-config";
import { TooltipProvider } from "@/components/ui/tooltip";

describe("BarChart", () => {
  const data = [
    { label: "May", value: 0 },
    { label: "Jun", value: 1.5 },
    { label: "Jul", value: 3 },
  ];

  it("reads every value in one accessible label", () => {
    render(<BarChart data={data} unit="hrs" title="Hours learned per month" />);
    expect(
      screen.getByRole("img", { name: "Hours learned per month: May 0 hrs, Jun 1.5 hrs, Jul 3 hrs" }),
    ).toBeTruthy();
  });

  it("draws no bar for zero and marks the current period teal", () => {
    const { container } = render(<BarChart data={data} unit="hrs" title="t" />);
    const bars = container.querySelectorAll("[data-bar]");
    expect(bars).toHaveLength(2);
    expect(bars[1]!.getAttribute("class")).toContain("fill-primary");
    expect(bars[0]!.getAttribute("class")).toContain("fill-primary/20");
  });

  it("puts a round number on the top gridline", () => {
    expect(niceMax(3)).toBe(5);
    expect(niceMax(12)).toBe(20);
    expect(niceMax(0)).toBe(1);
    expect(niceMax(100)).toBe(100);
  });
});

describe("SidebarNav (v2)", () => {
  it("marks the current page as a teal pill and puts the unread count in the Messages name", () => {
    render(<SidebarNav items={studentNav} messagesHref="/dashboard/messages" />);
    const current = screen.getByRole("link", { name: "Bookings" });
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(current.className).toContain("bg-primary");
    expect(screen.getByRole("link", { name: "Messages, 2 unread" })).toBeTruthy();
    // The topbar owns the unread-badge test id (E2E test 6).
    expect(screen.queryByTestId("unread-badge")).toBeNull();
  });

  it("keeps the label as the accessible name in the icon rail", () => {
    render(
      <TooltipProvider>
        <SidebarNav items={studentNav} messagesHref="/dashboard/messages" collapsed />
      </TooltipProvider>,
    );
    expect(screen.getByRole("link", { name: /^messages/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Find tutors" }).getAttribute("href")).toBe("/tutors");
  });

  it("ends with the account section and Log out", () => {
    render(<SidebarAccount links={[{ label: "Settings", href: "/tutor/settings" }]} />);
    expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();
    const logout = screen.getByRole("button", { name: /log out/i });
    expect(logout.className).toContain("text-spark-text");
  });
});

describe("PeopleList", () => {
  it("gives each row at most one action and a live dot only when live", () => {
    const { container } = render(
      <PeopleList
        people={[
          {
            id: "a",
            name: "Sofia Marchetti",
            avatarUrl: null,
            href: "/tutors/sofia",
            detail: "Maths · live now",
            live: true,
            action: { label: "Request", href: "/tutors/sofia#start-now", variant: "primary" },
          },
          {
            id: "b",
            name: "Marco Silva",
            avatarUrl: null,
            href: "/tutors/marco",
            detail: "Economics · 3 sessions",
            action: { label: "Book again", href: "/tutors/marco#book", variant: "outline" },
          },
        ]}
      />,
    );
    const rows = container.querySelectorAll("li");
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByRole("link", { name: "Request" }).getAttribute("href")).toBe(
      "/tutors/sofia#start-now",
    );
    expect(within(rows[1] as HTMLElement).getByRole("link", { name: "Book again" })).toBeTruthy();
    expect(rows[0]!.querySelector(".bg-live")).not.toBeNull();
    expect(rows[1]!.querySelector(".bg-live")).toBeNull();
  });
});
