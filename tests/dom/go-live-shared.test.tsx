import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * One go-live state for the tutor shell (live-globe rebuild Part F).
 *
 * Asserted: the dashboard banner and the topbar switch read and write the same
 * state, so flipping either updates both; there is exactly one switch named
 * "Available for instant sessions" on the page (the presence E2E finds it by
 * that name, strictly); the action runs once per click; a refusal snaps both
 * back and says why; while broadcasting the banner points back to the
 * broadcast and the switch is locked.
 */

const setInstantAvailability = vi.fn();
vi.mock("@/actions/presence", () => ({
  setInstantAvailability: (...a: unknown[]) => setInstantAvailability(...a),
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) } }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { GoLiveProvider } from "@/components/features/tutor/go-live-context";
import { GoLiveToggle } from "@/components/features/tutor/go-live-toggle";
import { GoLiveBanner } from "@/components/features/tutor/go-live-banner";

function renderShell(initialLive: boolean, broadcastHref: string | null = null) {
  return render(
    <GoLiveProvider initialLive={initialLive} broadcastHref={broadcastHref}>
      <GoLiveToggle variant="compact" initialLive={initialLive} broadcastHref={broadcastHref} />
      <GoLiveBanner othersLive={3} />
    </GoLiveProvider>,
  );
}

const theSwitch = () => screen.getByRole("switch", { name: /available for instant sessions/i });

beforeEach(() => {
  setInstantAvailability.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("shared go-live state", () => {
  it("has exactly one switch, and the banner button flips it", async () => {
    setInstantAvailability.mockResolvedValue({ isLive: true });
    renderShell(false);
    expect(screen.getAllByRole("switch")).toHaveLength(1);
    expect(theSwitch().getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Go live now" }));
    await waitFor(() => expect(theSwitch().getAttribute("aria-checked")).toBe("true"));
    // Once the action settles, the banner offers the way back.
    await waitFor(() => expect(screen.getByRole("button", { name: "Go offline" })).toBeTruthy());
    expect(setInstantAvailability).toHaveBeenCalledTimes(1);
    expect(setInstantAvailability).toHaveBeenCalledWith({ live: true });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/can request an instant session/i)));
  });

  it("the switch updates the banner too", async () => {
    setInstantAvailability.mockResolvedValue({ isLive: false });
    renderShell(true);
    expect(screen.getByText("Students can request you right now")).toBeTruthy();
    fireEvent.click(theSwitch());
    await waitFor(() => expect(screen.getByText("Go live to take instant requests")).toBeTruthy());
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/offline for instant sessions/i)));
  });

  it("a refusal snaps both back and says why", async () => {
    setInstantAvailability.mockResolvedValue({ error: "Verify your email first." });
    renderShell(false);
    fireEvent.click(screen.getByRole("button", { name: "Go live now" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Verify your email first."));
    await waitFor(() => expect(theSwitch().getAttribute("aria-checked")).toBe("false"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Go live now" })).toBeTruthy());
  });

  it("while broadcasting, the banner links back and the switch is locked", () => {
    renderShell(false, "/broadcast/b1");
    expect(screen.getByRole("link", { name: "Return to your broadcast" }).getAttribute("href")).toBe("/broadcast/b1");
    expect(theSwitch().hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: /go live now|go offline/i })).toBeNull();
  });
});
