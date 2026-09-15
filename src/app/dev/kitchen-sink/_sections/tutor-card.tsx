import * as React from "react";
import { Section, type Surface } from "./kit";
import { TutorCard } from "@/components/features/tutor-card";
import type { TutorCardData, LiveStatus } from "@/db/queries/tutors";

// TutorCard is the first Composed component (Phase 3). Until Part 3 of the
// design overhaul rebuilds it, it renders the old dark card through the
// compatibility aliases; the three live states are shown so nothing goes
// invisible in between.
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
      <div className="rounded-lg border border-border bg-surface-raised p-6">
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
