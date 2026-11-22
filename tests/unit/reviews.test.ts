import { describe, expect, it } from "vitest";
import { formatRating, reviewInputSchema, reviewerName, REVIEW_COMMENT_MAX } from "@/lib/reviews/review";

const ID = "6f1c1a3e-6a7b-4c1d-9e2f-0a1b2c3d4e5f";

describe("reviewInputSchema", () => {
  it("needs a whole 1 to 5 star rating", () => {
    for (const rating of [0, 6, 4.5]) {
      expect(reviewInputSchema.safeParse({ bookingId: ID, rating }).success).toBe(false);
    }
    expect(reviewInputSchema.safeParse({ bookingId: ID, rating: 5 }).success).toBe(true);
  });

  it("turns an empty or blank comment into null and caps the length", () => {
    const blank = reviewInputSchema.parse({ bookingId: ID, rating: 4, comment: "   " });
    expect(blank.comment).toBeNull();
    expect(reviewInputSchema.parse({ bookingId: ID, rating: 4, comment: " Great " }).comment).toBe("Great");
    expect(
      reviewInputSchema.safeParse({ bookingId: ID, rating: 4, comment: "x".repeat(REVIEW_COMMENT_MAX + 1) }).success,
    ).toBe(false);
  });

  it("refuses a booking id that is not a uuid", () => {
    expect(reviewInputSchema.safeParse({ bookingId: "abc", rating: 5 }).success).toBe(false);
  });
});

describe("reviewerName", () => {
  it("shows first name and last initial", () => {
    expect(reviewerName("Ada Chioma Obi")).toBe("Ada O.");
    expect(reviewerName("ada obi")).toBe("ada O.");
  });
  it("falls back to the display name, then to 'A student'", () => {
    expect(reviewerName(null, "Tola")).toBe("Tola");
    expect(reviewerName("  ", null)).toBe("A student");
  });
});

describe("formatRating", () => {
  it("shows one decimal from the numeric column", () => {
    expect(formatRating("4.67")).toBe("4.7");
    expect(formatRating(5)).toBe("5.0");
  });
});
