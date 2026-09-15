import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * The mobile bottom bar (design overhaul Part 2).
 *
 * Asserted: each role gets its own four destinations plus More; the unread
 * badge appears on Messages and nowhere else; the badge never claims the
 * `unread-badge` test id, which the topbar link owns (E2E test 6 asserts on a
 * single element with it, and the bar is in the DOM at every viewport); More
 * is a button, not a link, because it opens the drawer.
 */

let pathname = "/dashboard";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const unread = { count: 0 };
vi.mock("@/components/features/messaging/unread-context", () => ({
  useSharedUnreadCount: (enabled: boolean) => (enabled ? unread.count : 0),
}));

import { BottomNav } from "@/components/layout/bottom-nav";

beforeEach(() => {
  pathname = "/dashboard";
  unread.count = 0;
});

function renderBar(props: Partial<React.ComponentProps<typeof BottomNav>> = {}) {
  const onOpenMore = vi.fn();
  render(
    <BottomNav
      role="student"
      messagesHref="/dashboard/messages"
      onOpenMore={onOpenMore}
      {...props}
    />,
  );
  return { onOpenMore };
}

describe("BottomNav", () => {
  it("gives a student Home, Bookings, Messages, Wallet and More", () => {
    renderBar();
    for (const label of ["Home", "Bookings", "Messages", "Wallet"]) {
      expect(screen.getByRole("link", { name: new RegExp(`^${label}`, "i") })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "More" })).toBeTruthy();
    // Things that belong in the drawer, not the bar.
    expect(screen.queryByRole("link", { name: /favourites/i })).toBeNull();
  });

  it("gives a tutor their own four, with Earnings instead of Wallet", () => {
    pathname = "/tutor";
    renderBar({ role: "tutor", messagesHref: "/tutor/messages" });
    for (const label of ["Today", "Bookings", "Messages", "Earnings"]) {
      expect(screen.getByRole("link", { name: new RegExp(`^${label}`, "i") })).toBeTruthy();
    }
    expect(screen.queryByRole("link", { name: /broadcasts/i })).toBeNull();
  });

  it("gives an admin the queues, and no Messages (admins have no inbox)", () => {
    pathname = "/admin";
    unread.count = 4;
    renderBar({ role: "admin", messagesHref: undefined });
    for (const label of ["Overview", "Tutors", "Withdrawals", "Users"]) {
      expect(screen.getByRole("link", { name: new RegExp(`^${label}`, "i") })).toBeTruthy();
    }
    expect(screen.queryByRole("link", { name: /messages/i })).toBeNull();
  });

  it("marks the current destination", () => {
    pathname = "/dashboard/bookings";
    renderBar();
    expect(
      screen.getByRole("link", { name: /^bookings/i }).getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.getByRole("link", { name: /^home/i }).getAttribute("aria-current")).toBeNull();
  });

  it("badges Messages only, and leaves the unread-badge test id to the topbar", () => {
    unread.count = 3;
    renderBar();
    expect(screen.getByRole("link", { name: "Messages, 3 unread" })).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.queryByTestId("unread-badge")).toBeNull();
    // No other destination carries a count.
    expect(screen.getByRole("link", { name: /^wallet$/i })).toBeTruthy();
  });

  it("caps the badge at 9+", () => {
    unread.count = 42;
    renderBar();
    expect(screen.getByText("9+")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Messages, 42 unread" })).toBeTruthy();
  });

  it("shows no badge at zero", () => {
    renderBar();
    expect(screen.getByRole("link", { name: /^messages$/i })).toBeTruthy();
  });

  it("opens the drawer from More", () => {
    const { onOpenMore } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(onOpenMore).toHaveBeenCalledTimes(1);
  });
});
