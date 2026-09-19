import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";

/**
 * The top loading bar (2026-09-19). Asserted: nothing shows at rest; a click
 * on an in-app link to another page starts it; links it shouldn't react to
 * (same page, new tab, another site, modifier-clicks) don't; the route
 * changing finishes and hides it; and it gives up on its own if nothing
 * arrives.
 */

const route = { pathname: "/dashboard", search: "" };
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(route.search),
}));

import { NavigationProgress } from "@/components/layout/navigation-progress";

const bar = () => document.querySelector("[data-nav-progress]") as HTMLElement | null;

function link(href: string, attrs: Record<string, string> = {}) {
  const a = document.createElement("a");
  a.href = href;
  a.textContent = "go";
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
  document.body.appendChild(a);
  return a;
}

beforeEach(() => {
  vi.useFakeTimers();
  route.pathname = "/dashboard";
  route.search = "";
  window.history.replaceState({}, "", "/dashboard");
});
afterEach(() => {
  vi.useRealTimers();
  document.body.querySelectorAll("a").forEach((a) => a.remove());
});

describe("NavigationProgress", () => {
  it("shows nothing at rest and starts on an in-app link to another page", () => {
    render(<NavigationProgress />);
    expect(bar()).toBeNull();
    const a = link("/dashboard/bookings");
    // Like Next's <Link>, which always prevents the default to navigate itself.
    a.addEventListener("click", (e) => e.preventDefault());
    act(() => {
      fireEvent.click(a);
    });
    expect(bar()).not.toBeNull();
  });

  it("ignores same-page, new-tab, off-site and modifier clicks", () => {
    render(<NavigationProgress />);
    for (const a of [link("/dashboard"), link("/dashboard/wallet", { target: "_blank" }), link("https://example.com/x")]) {
      act(() => {
        fireEvent.click(a);
      });
    }
    act(() => {
      fireEvent.click(link("/dashboard/wallet"), { metaKey: true });
    });
    expect(bar()).toBeNull();
  });

  it("finishes and hides once the route changes", () => {
    const { rerender } = render(<NavigationProgress />);
    act(() => {
      fireEvent.click(link("/dashboard/wallet"));
    });
    expect(bar()).not.toBeNull();
    route.pathname = "/dashboard/wallet";
    rerender(<NavigationProgress />);
    expect(bar()!.style.width).toBe("100%");
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(bar()).toBeNull();
  });

  it("gives up by itself if the page never arrives", () => {
    render(<NavigationProgress />);
    act(() => {
      fireEvent.click(link("/dashboard/wallet"));
    });
    act(() => {
      vi.advanceTimersByTime(12_500);
    });
    expect(bar()).toBeNull();
  });
});
