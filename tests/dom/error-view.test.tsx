import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * The error screens (Phase 10 Part 5): every area's `error.tsx` renders
 * `ErrorView`, and the root layout's failure renders `global-error.tsx`. Both
 * say the fault is ours, offer Try again (which calls `reset`) and a way home,
 * show the support reference, and report once to Sentry.
 */

const m = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: (...a: unknown[]) => m.capture(...a) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ErrorView } from "@/components/layout/error-view";
import StudentError from "@/app/(student)/error";
import SessionError from "@/app/(session)/error";
import GlobalError from "@/app/global-error";
import { EmptyState } from "@/components/ui/empty-state";

const boom = () => Object.assign(new Error("db timeout"), { digest: "abc123" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("ErrorView", () => {
  it("says what happened, offers both ways out, and reports once", () => {
    const reset = vi.fn();
    render(
      <ErrorView error={boom()} reset={reset} message="Something broke here." home={{ href: "/dashboard", label: "Home" }} />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("This page didn't load");
    expect(screen.getByRole("alert").textContent).toContain("Nothing you did caused it.");
    expect(screen.getByText("abc123")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/dashboard");
    expect(m.capture).toHaveBeenCalledTimes(1);
  });

  it("each area points home to its own place", () => {
    const { unmount } = render(<StudentError error={boom()} reset={() => {}} />);
    expect(screen.getByRole("link", { name: "Go to your dashboard" }).getAttribute("href")).toBe("/dashboard");
    unmount();
    render(<SessionError error={boom()} reset={() => {}} />);
    expect(screen.getByRole("alert").textContent).toContain("If your session was running, it still is.");
  });
});

describe("global-error", () => {
  it("renders a working page with no stylesheet to lean on", () => {
    const reset = vi.fn();
    // It renders its own <html>; mounting it inside the test container is enough to read it.
    render(<GlobalError error={boom()} reset={reset} />, { container: document.documentElement });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("didn’t load");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Go to the home page" }).getAttribute("href")).toBe("/");
    expect(m.capture).toHaveBeenCalledTimes(1);
  });
});

describe("EmptyState", () => {
  it("shows the icon plain, with no circle or tile behind it", () => {
    const { container } = render(<EmptyState icon={<svg data-testid="i" />} title="Nothing yet" />);
    const iconWrap = screen.getByTestId("i").parentElement!;
    expect(iconWrap.className).not.toMatch(/rounded-full|bg-/);
    expect(container.textContent).toContain("Nothing yet");
  });
});

describe("accessibility fixes from the Part 5 Lighthouse pass", () => {
  it("a card title can sit straight under the page's h1 as an h2", async () => {
    const { CardTitle } = await import("@/components/ui/card");
    const { unmount } = render(<CardTitle as="h2">Password</CardTitle>);
    expect(screen.getByRole("heading", { level: 2, name: "Password" })).toBeTruthy();
    unmount();
    render(<CardTitle>Default</CardTitle>);
    expect(screen.getByRole("heading", { level: 3, name: "Default" })).toBeTruthy();
  });
});
