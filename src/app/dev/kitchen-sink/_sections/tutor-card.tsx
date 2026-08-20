import * as React from "react";
import { Section, type Surface } from "./kit";
import { TutorCard } from "@/components/features/tutor-card";
import type { TutorCardData, LiveStatus } from "@/db/queries/tutors";

// TutorCard is the first Composed component (Phase 3). It is intrinsically an
// ink card (Phase 2 ink amendment §3), designed to sit on the white content
// panel — ink shell → white panel → ink cards. So this demo always renders the
// three live states on a white panel regardless of the page surface toggle; the
// toggle governs the surrounding chrome/headings only.
const BASE: Omit<TutorCardData, "userId" | "slug" | "displayName" | "liveStatus"> = {
  avatarUrl: null,
  country: "GB",
  headline: "Exam-technique specialist — maths & physics, 8 yrs",
  ratingAvg: 4.7,
  ratingCount: 128,
  hourlyRateCredits: 45,
  subjects: ["Algebra", "Physics", "SAT / ACT Test Prep"],
  isFavourited: false,
};

const STATES: { status: LiveStatus; name: string; favourited: boolean }[] = [
  { status: "offline", name: "Amara Okafor", favourited: false },
  { status: "online", name: "Liam Bennett", favourited: true },
  { status: "live", name: "Sofia Marchetti", favourited: false },
];

function mock({ status, name, favourited }: (typeof STATES)[number]): TutorCardData {
  return {
    ...BASE,
    userId: `demo-${status}`,
    slug: status,
    displayName: name,
    liveStatus: status,
    isFavourited: favourited,
  };
}

export function TutorCardSection({ surface }: { surface: Surface }) {
  return (
    <Section id="tutor-card" title="TutorCard (composed)" surface={surface}>
      {/* The white content panel the ink cards actually live on. */}
      <div className="rounded-lg bg-white p-6 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STATES.map((s) => (
            <TutorCard
              key={s.status}
              tutor={mock(s)}
              favouriteMode="anon"
            />
          ))}
        </div>
      </div>
    </Section>
  );
}
