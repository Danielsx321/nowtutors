import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

/**
 * The tutor card (design overhaul Part 3, DESIGN.md "Cards" and "The live
 * signal").
 *
 * Asserted: an instant-available tutor shows the ring, the "Live now" word and
 * a "Request now" action; a live tutor who doesn't take instant requests does
 * not; an offline tutor shows no status text at all; a broadcasting tutor gets
 * LIVE and "Watch live" with no ring; a tutor with no photo shows initials and
 * keeps the name; new tutors say New rather than 0; the price carries the
 * "≈ $" anchor only when a rate is passed; the row variant has the same states.
 */

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
vi.mock("@/actions/favourites", () => ({ toggleFavourite: vi.fn() }));

import { TutorCard } from "@/components/features/tutor-card";
import type { TutorCardData } from "@/db/queries/tutors";

function tutor(over: Partial<TutorCardData> = {}): TutorCardData {
  return {
    userId: "t1",
    slug: "liam",
    displayName: "Liam Bennett",
    avatarUrl: "https://example.supabase.co/storage/v1/object/public/avatars/liam.jpg",
    country: "GB",
    headline: "Maths and physics",
    ratingAvg: 0,
    ratingCount: 0,
    hourlyRateCredits: 45,
    yearsExperience: 8,
    completedSessions: 312,
    acceptsInstant: true,
    subjects: ["Algebra"],
    liveStatus: "offline",
    liveBroadcastId: null,
    isFavourited: false,
    ...over,
  };
}

function renderCard(t: TutorCardData, props: Partial<React.ComponentProps<typeof TutorCard>> = {}) {
  const { container } = render(<TutorCard tutor={t} favouriteMode="anon" {...props} />);
  return container.querySelector("article")!;
}

const ring = (card: HTMLElement) => card.querySelector(".ring-live");

describe("TutorCard, grid", () => {
  it("instant-available: ring, the words Live now, and Request now", () => {
    const card = renderCard(tutor({ liveStatus: "online" }));
    expect(ring(card)).not.toBeNull();
    expect(within(card).getByText("Live now")).toBeTruthy();
    const action = within(card).getByRole("link", { name: /^request now$/i });
    expect(action.getAttribute("href")).toBe("/tutors/liam#start-now");
    expect(card.dataset.state).toBe("instant");
  });

  it("online but not taking instant requests reads as bookable, not live", () => {
    const card = renderCard(tutor({ liveStatus: "online", acceptsInstant: false }));
    expect(ring(card)).toBeNull();
    expect(within(card).queryByText("Live now")).toBeNull();
    expect(within(card).getByRole("link", { name: /^book a session$/i })).toBeTruthy();
  });

  it("offline: no status text of any kind", () => {
    const card = renderCard(tutor());
    expect(ring(card)).toBeNull();
    expect(within(card).queryByText(/live|offline|online/i)).toBeNull();
    expect(within(card).getByRole("link", { name: /^book a session$/i })).toBeTruthy();
  });

  it("broadcasting: LIVE linking to the broadcast, Watch live, no ring", () => {
    const card = renderCard(tutor({ liveStatus: "live", liveBroadcastId: "b1" }));
    expect(ring(card)).toBeNull();
    expect(within(card).getByText("LIVE")).toBeTruthy();
    expect(within(card).getByRole("link", { name: /^watch live$/i }).getAttribute("href")).toBe("/live/b1");
    expect(within(card).queryByRole("link", { name: /^request now$/i })).toBeNull();
  });

  it("no photo: initials on the muted panel, and the name stays readable", () => {
    const card = renderCard(tutor({ avatarUrl: null }));
    expect(within(card).queryByRole("img", { name: /^photo of/i })).toBeNull();
    expect(within(card).getByRole("img", { name: "Liam Bennett, no photo yet" })).toBeTruthy();
    expect(within(card).getByText("LB")).toBeTruthy();
    expect(within(card).getByRole("link", { name: "Liam Bennett" })).toBeTruthy();
  });

  it("proof row: Experience, Sessions, Rate, and New for a new tutor", () => {
    const card = renderCard(tutor({ yearsExperience: null, completedSessions: 0 }));
    const labels = Array.from(card.querySelectorAll("dt")).map((d) => d.textContent);
    expect(labels).toEqual(["Experience", "Sessions", "Rate"]);
    expect(within(card).getAllByText("New")).toHaveLength(2);
    expect(within(card).queryByText(/rating|★/i)).toBeNull();
  });

  it("price carries the ≈ $ anchor only when a rate is passed", () => {
    const withRate = renderCard(tutor(), { usdPerCredit: 1.5 });
    expect(within(withRate).getByLabelText("45 credits per hr, about $67.50")).toBeTruthy();
  });

  it("price without a rate shows credits alone", () => {
    const noRate = renderCard(tutor());
    expect(within(noRate).getByLabelText("45 credits per hr")).toBeTruthy();
  });

  it("v2: country by name, the first subject as a tag, and a teal Request now", () => {
    const card = renderCard(tutor({ liveStatus: "online", subjects: ["Algebra", "Physics"] }));
    expect(within(card).getByText("United Kingdom")).toBeTruthy();
    expect(within(card).getByText("Algebra")).toBeTruthy();
    expect(within(card).queryByText("Physics")).toBeNull();
    const action = within(card).getByRole("link", { name: /^request now$/i });
    expect(action.className).toMatch(/\bbg-primary\b/);
    expect(action.className).not.toMatch(/\bbg-live\b/);
  });

  it("v2: the rate cell stacks credits over the dollar anchor", () => {
    const card = renderCard(tutor(), { usdPerCredit: 1.5 });
    const rate = within(card).getByLabelText("45 credits per hr, about $67.50");
    expect(rate.textContent).toContain("45 cr");
    expect(rate.textContent).toContain("≈ $67.50");
    expect(rate.textContent).not.toContain("/ hr");
  });

  it("the whole card links to the profile", () => {
    renderCard(tutor());
    expect(screen.getByRole("link", { name: "Liam Bennett" }).getAttribute("href")).toBe("/tutors/liam");
  });
});

describe("TutorCard, row (phones)", () => {
  it("keeps the live states and the one action", () => {
    const card = renderCard(tutor({ liveStatus: "online" }), { variant: "row" });
    expect(ring(card)).not.toBeNull();
    expect(within(card).getByText("Live now")).toBeTruthy();
    expect(within(card).getByRole("link", { name: /^request now$/i })).toBeTruthy();
  });

  it("offline row has no status text", () => {
    const card = renderCard(tutor(), { variant: "row" });
    expect(within(card).queryByText(/live|offline|online/i)).toBeNull();
    expect(within(card).getByText(/8y experience · 312 sessions/)).toBeTruthy();
  });
});
