import * as React from "react";

/**
 * "How it works" (pages.html, Home; back on the home page after the audit of
 * 18 Nov 2026, which asked for it). Parked with the v2 home in round 3
 * Part C; now restyled for the browse column: the same plain h2 as the
 * tutor sections around it (no tracked all-caps kicker, a banned tell).
 * The hero band's "How it works" link jumps here (`#how-it-works`).
 */
const STEPS = [
  {
    title: "Find your tutor",
    text: "Search by subject and price, then look at real photos, experience and sessions taught.",
  },
  {
    title: "Request or book",
    text: "Send an instant request with a 60-second answer, or pick a time on their calendar.",
  },
  {
    title: "Learn in the browser",
    text: "Check your mic, join the room and learn face to face. Pay with credits or PayPal.",
  },
];

export function Steps() {
  return (
    <section id="how-it-works" aria-labelledby="steps-title" className="mt-12 scroll-mt-[72px]">
      <h2 id="steps-title" className="mb-3.5 font-display text-h2 font-semibold text-text">
        How it works
      </h2>
      <ol className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))]">
        {STEPS.map((s, i) => (
          <li
            key={s.title}
            className="flex flex-col gap-2 rounded-card border border-border bg-surface-raised p-5"
          >
            <span className="font-display text-small font-semibold text-accent">Step {i + 1}</span>
            <h3 className="font-display text-[19px] font-semibold leading-[1.2] text-text">{s.title}</h3>
            <p className="text-body text-text-muted">{s.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
