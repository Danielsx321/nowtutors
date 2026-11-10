import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * The On hold card can put a tutor back live without waiting for a save
 * (2026-11-10). Faked: the admin server actions. Asserted: "Put back live"
 * asks first, the confirm calls approveTutor once with the tutor's id, Cancel
 * backs out without a call, and a tutor with no photo cannot be put back
 * (the server refuses the same way).
 */

const approveTutor = vi.fn(async (input: { tutorId: string }) => ({ ok: true as const, input }));
vi.mock("@/actions/admin-tutors", () => ({
  approveTutor: (input: { tutorId: string }) => approveTutor(input),
  rejectTutor: vi.fn(async () => ({ ok: true as const })),
  markTutorReviewed: vi.fn(),
  requestTutorChanges: vi.fn(),
}));

import { OnHoldCard, type QueueTutor } from "@/components/features/admin/tutor-queue";

const tutor: QueueTutor = {
  userId: "00000000-0000-4000-8000-000000000001",
  slug: "jouana",
  displayName: "Jouana",
  email: "tutor@example.test",
  avatarUrl: "https://example.test/a.jpg",
  country: null,
  headline: "French tutor",
  about: null,
  introVideoUrl: null,
  education: null,
  yearsExperience: 7,
  languages: ["French"],
  hourlyRateCredits: 30,
  approvalNote: null,
  subjects: [],
  profileChangedAt: null,
  profileReviewedAt: "2026-10-27T16:24:12.000Z",
};

describe("OnHoldCard: put back live", () => {
  beforeEach(() => approveTutor.mockClear());

  it("asks first, then approves the tutor", async () => {
    render(<OnHoldCard tutor={tutor} />);
    fireEvent.click(screen.getByRole("button", { name: /put back live/i }));
    expect(approveTutor).not.toHaveBeenCalled();
    expect(screen.getByText(/undo the hold/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /yes, put them back live/i }));
    await vi.waitFor(() => expect(approveTutor).toHaveBeenCalledTimes(1));
    expect(approveTutor).toHaveBeenCalledWith({ tutorId: tutor.userId });
  });

  it("Cancel backs out without a call", () => {
    render(<OnHoldCard tutor={tutor} />);
    fireEvent.click(screen.getByRole("button", { name: /put back live/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByText(/undo the hold/i)).toBeNull();
    expect(approveTutor).not.toHaveBeenCalled();
  });

  it("is disabled without a profile photo", () => {
    render(<OnHoldCard tutor={{ ...tutor, avatarUrl: null }} />);
    const button = screen.getByRole("button", { name: /put back live/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/profile photo is required/i)).toBeTruthy();
  });
});
