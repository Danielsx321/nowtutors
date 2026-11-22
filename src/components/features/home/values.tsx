import * as React from "react";

/**
 * "Built for students" (audit, 18 Nov 2026): what a student can count on,
 * after the reviewer asked for values set out the way the big tutoring sites
 * do. Every line is something the app already does, nothing padded
 * (SPEC §9.6 "Banned tells": no invented content). "Checked" is the admin
 * approval every tutor passes before they appear (SPEC §4.1 approval_status).
 * No "24/7": tutors choose their own hours.
 */
const VALUES = [
  {
    title: "Real people, not a chatbot",
    text: "Every lesson is with a human tutor, face to face in your browser.",
  },
  {
    title: "Tutors checked before they teach",
    text: "Our team reviews each tutor's profile before it appears on NowTutors.",
  },
  {
    title: "Live now or booked for later",
    text: "Start with a tutor who is online this minute, or pick a time on their calendar.",
  },
];

export function Values() {
  return (
    <section aria-labelledby="values-title" className="mt-12">
      <h2 id="values-title" className="mb-3.5 font-display text-h2 font-semibold text-text">
        Built for students
      </h2>
      <ul className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))]">
        {VALUES.map((v) => (
          <li key={v.title} className="flex flex-col gap-2 rounded-card border border-border bg-surface-raised p-5">
            <h3 className="font-display text-[19px] font-semibold leading-[1.2] text-text">{v.title}</h3>
            <p className="text-body text-text-muted">{v.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
