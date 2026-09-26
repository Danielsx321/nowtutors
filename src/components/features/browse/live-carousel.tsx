"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The "Live now" row over the grid (DESIGN.md v3 "Public pages"; round 3
 * Part C, after Oranum's top row): a scroll-snap list of cards with a previous
 * and a next button that move one viewport at a time. No library. Renders
 * nothing when there is nobody live, so the test project (no live tutors)
 * shows the grid alone. The cards come in as children, rendered on the server.
 */
export function LiveCarousel({
  id = "live-now-title",
  liveCount,
  items,
}: {
  id?: string;
  liveCount: number;
  /** One rendered card per live tutor. */
  items: React.ReactNode[];
}) {
  const ref = React.useRef<HTMLUListElement>(null);
  if (items.length === 0) return null;

  const scroll = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth, behavior: "smooth" });
  };

  return (
    <section aria-labelledby={id} className="mb-9">
      <div className="mb-3.5 flex items-baseline justify-between gap-3">
        <h2 id={id} className="font-display text-h2 font-semibold text-text">
          Live now
        </h2>
        <p data-numeric className="inline-flex items-center gap-2 text-small font-semibold text-live">
          <span aria-hidden className="animate-pulse-live size-2 rounded-full bg-live" />
          {liveCount} {liveCount === 1 ? "tutor" : "tutors"} live
        </p>
      </div>
      <div className="relative">
        <ul
          ref={ref}
          className="-mx-1 flex snap-x snap-mandatory gap-[18px] overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {items.map((item, i) => (
            <li
              key={i}
              className="w-[82%] shrink-0 snap-start sm:w-[calc(50%-9px)] lg:w-[calc(33.333%-12px)] xl:w-[calc(25%-13.5px)]"
            >
              {item}
            </li>
          ))}
        </ul>
        {items.length > 1 && (
          <>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Previous live tutors"
              onClick={() => scroll(-1)}
              className="absolute -left-4 top-1/2 hidden size-10 -translate-y-1/2 bg-surface-raised shadow-lift lg:inline-flex"
            >
              <ChevronLeft />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Next live tutors"
              onClick={() => scroll(1)}
              className="absolute -right-4 top-1/2 hidden size-10 -translate-y-1/2 bg-surface-raised shadow-lift lg:inline-flex"
            >
              <ChevronRight />
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
