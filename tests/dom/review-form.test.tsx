import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const submitReview = vi.hoisted(() => vi.fn());
vi.mock("@/actions/reviews", () => ({ submitReview }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ReviewForm } from "@/components/features/reviews/review-form";

const ID = "6f1c1a3e-6a7b-4c1d-9e2f-0a1b2c3d4e5f";

describe("ReviewForm (reviews v1)", () => {
  it("asks for stars before sending", async () => {
    render(<ReviewForm bookingId={ID} tutorFirstName="Tina" existing={null} />);
    expect(screen.getByRole("heading", { name: "How was your lesson with Tina?" })).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Send review" }));
    expect(await screen.findByText("Pick a star rating.")).toBeTruthy();
    expect(submitReview).not.toHaveBeenCalled();
  });

  it("sends the rating and comment, then shows the review", async () => {
    submitReview.mockResolvedValueOnce({ ok: true });
    render(<ReviewForm bookingId={ID} tutorFirstName="Tina" existing={null} />);
    fireEvent.click(screen.getByRole("radio", { name: /4 stars/ }));
    fireEvent.change(screen.getByLabelText(/What went well/), { target: { value: "Very clear." } });
    fireEvent.click(screen.getByRole("button", { name: "Send review" }));
    await waitFor(() => expect(submitReview).toHaveBeenCalledWith({ bookingId: ID, rating: 4, comment: "Very clear." }));
    expect(await screen.findByRole("heading", { name: "Your review" })).toBeTruthy();
  });

  it("shows the server's refusal", async () => {
    submitReview.mockResolvedValueOnce({ error: "You have already reviewed this lesson." });
    render(<ReviewForm bookingId={ID} tutorFirstName="Tina" existing={null} />);
    fireEvent.click(screen.getByRole("radio", { name: /5 stars/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send review" }));
    expect(await screen.findByText("You have already reviewed this lesson.")).toBeTruthy();
  });

  it("shows an existing review instead of the form", () => {
    render(<ReviewForm bookingId={ID} tutorFirstName="Tina" existing={{ rating: 5, comment: "Great." }} />);
    expect(screen.getByRole("heading", { name: "Your review" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send review" })).toBeNull();
  });
});
