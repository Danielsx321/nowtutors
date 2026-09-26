import * as React from "react";
import { SubjectSearch } from "@/components/features/tutor-filters";
import type { Subject } from "@/lib/tutors/browse-url";

/**
 * The blue search band over home and browse (DESIGN.md v3 "Public pages";
 * round 3 Part C, from the InstaEDU reference): a heading, one line, and the
 * subject search with the orange act-now submit. Solid `primary`, no texture
 * and no gradient (DESIGN.md "Banned tells").
 */
export function SearchBand({
  id,
  heading,
  subline,
  subjects,
  initialMiss = null,
}: {
  /** The heading's id, so the page can label its section with it. */
  id: string;
  heading: string;
  subline: string;
  subjects: Subject[];
  initialMiss?: string | null;
}) {
  return (
    <section aria-labelledby={id} className="bg-primary px-4 py-10 text-on-primary md:px-6 md:py-14">
      <div className="mx-auto max-w-[760px] text-center">
        <h1
          id={id}
          className="font-display text-[clamp(30px,3.6vw,44px)] font-semibold leading-[1.05] tracking-[-0.02em]"
        >
          {heading}
        </h1>
        <p className="mx-auto mt-3 max-w-[52ch] text-body-lg text-on-primary/85">{subline}</p>
        <div className="mt-7 text-left [&>form]:mx-auto [&>form]:max-w-[720px]">
          <SubjectSearch
            subjects={subjects}
            initialMiss={initialMiss}
            submitLabel="See tutors"
            submitVariant="highlight"
            placeholder="What do you want to learn? Try 'Algebra'"
            onDark
          />
        </div>
      </div>
    </section>
  );
}
