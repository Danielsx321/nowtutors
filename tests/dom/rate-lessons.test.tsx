import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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

import { RateLessons } from "@/components/features/reviews/rate-lessons";

describe("RateLessons (dashboard review prompt)", () => {
  it("links each unrated lesson to its review form", () => {
    render(
      <RateLessons
        timeZone="UTC"
        lessons={[
          { bookingId: "b1", tutorName: "Tina Ruiz", tutorAvatarUrl: null, subjectName: "Spanish", endedAt: new Date("2026-11-20T10:00:00Z") },
          { bookingId: "b2", tutorName: null, tutorAvatarUrl: null, subjectName: null, endedAt: new Date("2026-11-21T10:00:00Z") },
        ]}
      />,
    );
    expect(screen.getByText("Spanish with Tina")).toBeTruthy();
    expect(screen.getByText("Lesson with your tutor")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Rate your Spanish lesson with Tina" }).getAttribute("href")).toBe("/dashboard/bookings/b1#review");
    expect(screen.getByRole("link", { name: "Rate your lesson with your tutor" }).getAttribute("href")).toBe("/dashboard/bookings/b2#review");
  });
});
