import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * The "Live now" carousel (design round 3 Part C). Asserted: nothing renders
 * with no live tutors; every item renders with the count; the next and previous
 * buttons scroll the list by one viewport.
 */

import { LiveCarousel } from "@/components/features/browse/live-carousel";

describe("LiveCarousel", () => {
  it("renders nothing when nobody is live", () => {
    const { container } = render(<LiveCarousel liveCount={0} items={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders every item with the live count", () => {
    render(
      <LiveCarousel liveCount={3} items={[<b key="a">A</b>, <b key="b">B</b>, <b key="c">C</b>]} />,
    );
    expect(screen.getByRole("heading", { name: "Live now" })).toBeTruthy();
    expect(screen.getByText("3 tutors live")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("says one tutor rather than 1 tutors", () => {
    render(<LiveCarousel liveCount={1} items={[<b key="a">A</b>]} />);
    expect(screen.getByText("1 tutor live")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /next live tutors/i })).toBeNull();
  });

  it("the buttons scroll the list by one viewport", () => {
    render(<LiveCarousel liveCount={2} items={[<b key="a">A</b>, <b key="b">B</b>]} />);
    const list = screen.getByRole("list");
    const scrollBy = vi.fn();
    Object.defineProperty(list, "scrollBy", { value: scrollBy });
    Object.defineProperty(list, "clientWidth", { value: 900 });
    fireEvent.click(screen.getByRole("button", { name: /next live tutors/i }));
    expect(scrollBy).toHaveBeenCalledWith({ left: 900, behavior: "smooth" });
    fireEvent.click(screen.getByRole("button", { name: /previous live tutors/i }));
    expect(scrollBy).toHaveBeenCalledWith({ left: -900, behavior: "smooth" });
  });
});
