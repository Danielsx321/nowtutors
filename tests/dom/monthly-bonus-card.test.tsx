import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MonthlyBonusCard } from "@/components/features/tutor/monthly-bonus-card";
import type { TutorMonthlyAward, TutorMonthProgress } from "@/db/queries/availability-bonus";

/**
 * The monthly availability bonus card on `/tutor/earnings`
 * (monthly-availability-bonus, 2026-11-15): hours against the 20-hour target,
 * days left, the reached state, the paid list with the November deduction
 * note, and nothing at all when the bonus is off.
 */

const SETTINGS = { enabled: true, minHours: 20, credits: 100 };

function progress(liveSeconds: number, daysLeft = 16): TutorMonthProgress {
  return { monthStart: "2026-11-01", liveSeconds, daysLeft };
}

const award: TutorMonthlyAward = {
  id: "a1",
  monthStart: "2026-11-01",
  liveSeconds: 76_200,
  credits: 60,
  weeklyCreditsDeducted: 40,
  createdAt: new Date("2026-12-01T00:20:00Z"),
};

describe("MonthlyBonusCard", () => {
  it("shows hours so far this month, the target, what is left and the days left", () => {
    render(<MonthlyBonusCard progress={progress(12 * 3600)} awards={[]} settings={SETTINGS} usdPerCredit={1} />);
    expect(screen.getByText("Monthly availability bonus")).toBeTruthy();
    expect(screen.getByText("This month, November 2026")).toBeTruthy();
    expect(screen.getByText("12h 0m")).toBeTruthy();
    expect(screen.getByText("of 20 hours")).toBeTruthy();
    expect(screen.getByText("8h 0m to go")).toBeTruthy();
    expect(screen.getByText("16 days left this month")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("60");
    expect(screen.getByText(/No monthly bonus paid yet/)).toBeTruthy();
    expect(screen.getByText(/on the 1st of the next month/)).toBeTruthy();
  });

  it("says reached once the target is met and fills the bar", () => {
    render(<MonthlyBonusCard progress={progress(20 * 3600, 1)} awards={[]} settings={SETTINGS} usdPerCredit={1} />);
    expect(screen.getByText("Reached this month")).toBeTruthy();
    expect(screen.getByText("1 day left this month")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
  });

  it("lists the months already paid, with the weekly deduction note", () => {
    render(<MonthlyBonusCard progress={progress(0)} awards={[award]} settings={SETTINGS} usdPerCredit={1} />);
    expect(screen.getAllByText("November 2026").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("21h 10m")).toBeTruthy();
    expect(screen.getByText("after 40 paid weekly")).toBeTruthy();
  });

  it("no deduction note when nothing was paid weekly", () => {
    render(
      <MonthlyBonusCard
        progress={progress(0)}
        awards={[{ ...award, credits: 100, weeklyCreditsDeducted: 0 }]}
        settings={SETTINGS}
        usdPerCredit={1}
      />,
    );
    expect(screen.queryByText(/paid weekly/)).toBeNull();
  });

  it("renders nothing when the bonus is switched off", () => {
    const { container } = render(
      <MonthlyBonusCard progress={progress(30 * 3600)} awards={[award]} settings={{ ...SETTINGS, enabled: false }} usdPerCredit={1} />,
    );
    expect(container.innerHTML).toBe("");
  });
});
