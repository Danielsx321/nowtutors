import * as React from "react";
import { Section, type Surface } from "./kit";
import { TutorCard } from "@/components/features/tutor-card";
import type { TutorCardData, LiveStatus } from "@/db/queries/tutors";

// The rebuilt card (design overhaul Part 3): the three states in both
// variants. All demo tutors have no photo, so the initials fallback shows too.
const BASE: Omit<TutorCardData, "userId" | "slug" | "displayName" | "liveStatus"> = {
  avatarUrl: null,
  country: "GB",
  headline: "Exam-technique specialist for maths and physics, GCSE to A-level",
  ratingAvg: 0,
  ratingCount: 0,
  hourlyRateCredits: 45,
  yearsExperience: 8,
  completedSessions: 312,
  acceptsInstant: true,
  subjects: ["Algebra", "Physics", "SAT / ACT Test Prep"],
  isFavourited: false,
};

const STATES: { status: LiveStatus; name: string; favourited: boolean; fresh?: boolean }[] = [
  { status: "online", name: "Liam Bennett", favourited: true },
  { status: "live", name: "Sofia Marchetti", favourited: false },
  { status: "offline", name: "Amara Okafor", favourited: false, fresh: true },
];

function mock({ status, name, favourited, fresh }: (typeof STATES)[number]): TutorCardData {
  return {
    ...BASE,
    userId: `demo-${status}`,
    slug: status,
    displayName: name,
    liveStatus: status,
    liveBroadcastId: status === "live" ? "demo-broadcast" : null,
    isFavourited: favourited,
    ...(fresh ? { yearsExperience: null, completedSessions: 0 } : {}),
  };
}

export function TutorCardSection({ surface }: { surface: Surface }) {
  return (
    <Section id="tutor-card" title="TutorCard (composed)" surface={surface}>
      <div className="space-y-6 rounded-lg border border-border bg-surface p-6">
        <p className="text-small text-text-muted">
          Grid: instant-available (ring, Live now, Request now), broadcasting (LIVE, Watch live), offline new tutor (no status text, New).
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STATES.map((s) => (
            <TutorCard key={s.status} tutor={mock(s)} favouriteMode="anon" usdPerCredit={1} />
          ))}
        </div>
        <p className="text-small text-text-muted">Row, used below md.</p>
        <div className="grid max-w-sm gap-3">
          {STATES.map((s) => (
            <TutorCard key={s.status} tutor={mock(s)} favouriteMode="anon" usdPerCredit={1} variant="row" />
          ))}
        </div>
      </div>
    </Section>
  );
}
