import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WeeklyBonusCard } from "@/components/features/tutor/weekly-bonus-card";
import type { TutorAward, TutorWeekProgress } from "@/db/queries/availability-bonus";

/**
 * The weekly availability bonus card on `/tutor/earnings` (availability-bonus,
 * 2026-10-14): hours against the target, the reached state, the paid list,
 * and nothing at all when the bonus is off.
 */

const SETTINGS = { enabled: true, minHours: 5, credits: 40 };

function progress(liveSeconds: number, days?: number[]): TutorWeekProgress {
  const secs = days ?? [liveSeconds, 0, 0, 0, 0, 0, 0];
  return {
    weekStart: "2026-10-12",
    liveSeconds,
    days: ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"].map(
      (day, i) => ({ day, seconds: secs[i] }),
    ),
  };
}

const award: TutorAward = {
  id: "a1",
  weekStart: "2026-10-05",
  liveSeconds: 22_200,
  credits: 40,
  createdAt: new Date("2026-10-12T00:20:00Z"),
};

describe("WeeklyBonusCard", () => {
  it("shows hours so far, the target and what is left", () => {
    render(
      <WeeklyBonusCard progress={progress(12_000, [7_200, 4_800, 0, 0, 0, 0, 0])} awards={[]} settings={SETTINGS} usdPerCredit={1} />,
    );
    expect(screen.getByText("Weekly availability bonus")).toBeTruthy();
    expect(screen.getByText("3h 20m")).toBeTruthy();
    expect(screen.getByText("of 5 hours")).toBeTruthy();
    expect(screen.getByText("1h 40m to go")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("67");
    expect(screen.getByText(/No bonus paid yet/)).toBeTruthy();
  });

  it("says reached once the target is met and fills the bar", () => {
    render(<WeeklyBonusCard progress={progress(18_000)} awards={[]} settings={SETTINGS} usdPerCredit={1} />);
    expect(screen.getByText("Reached this week")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
  });

  it("lists the weeks already paid with the dollar anchor", () => {
    render(<WeeklyBonusCard progress={progress(0)} awards={[award]} settings={SETTINGS} usdPerCredit={1} />);
    expect(screen.getByText("5 to 11 Oct")).toBeTruthy();
    expect(screen.getByText("6h 10m")).toBeTruthy();
    expect(screen.getAllByText("40 credits, about $40").length).toBeGreaterThanOrEqual(1);
  });

  it("drops the dollar anchor when no payout rate is set", () => {
    render(<WeeklyBonusCard progress={progress(0)} awards={[award]} settings={SETTINGS} usdPerCredit={null} />);
    expect(screen.queryByText(/about \$/)).toBeNull();
    expect(screen.getAllByText("40 credits").length).toBeGreaterThanOrEqual(1);
  });

  it("shows the day strip with per-day hours", () => {
    render(
      <WeeklyBonusCard
        progress={progress(5_400, [3_600, 1_800, 0, 0, 0, 0, 0])}
        awards={[]}
        settings={SETTINGS}
        usdPerCredit={1}
      />,
    );
    const strip = screen.getByRole("list", { name: "Live time by day" });
    expect(strip.textContent).toContain("Mon");
    expect(strip.textContent).toContain("1h 0m");
    expect(strip.textContent).toContain("30m");
  });

  it("renders nothing when the bonus is switched off", () => {
    const { container } = render(
      <WeeklyBonusCard progress={progress(18_000)} awards={[award]} settings={{ ...SETTINGS, enabled: false }} usdPerCredit={1} />,
    );
    expect(container.innerHTML).toBe("");
  });
});
