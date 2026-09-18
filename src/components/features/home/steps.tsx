import { SectionHeading } from "@/components/features/home/section-heading";

/** "Three steps to your lesson" (pages.html, Home). */
const STEPS = [
  {
    title: "Find a tutor who's live",
    text: "Filter by subject and price, then look at real photos, experience and sessions taught.",
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
    <section aria-labelledby="steps-title" className="px-4 pb-[clamp(64px,9vw,120px)] md:px-6">
      <div className="mx-auto max-w-[var(--container-page)]">
        <SectionHeading id="steps-title" kicker="How it works" title="Three steps to your lesson" />
        <ol className="grid gap-[18px] [grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))]">
          {STEPS.map((s, i) => (
            <li
              key={s.title}
              className="flex flex-col gap-3 rounded-card border border-border bg-surface-raised p-6"
            >
              <span className="font-display text-small font-semibold text-accent">Step {i + 1}</span>
              <h3 className="font-display text-[22px] font-semibold leading-[1.15] tracking-[-0.02em] text-text">
                {s.title}
              </h3>
              <p className="text-body text-text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
