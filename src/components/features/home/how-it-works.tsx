import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TRUST_GUARANTEE, TRUST_GUARANTEE_CONFIRMED, TRUST_PAYMENT } from "@/lib/copy/trust";

const STEPS = [
  {
    title: "Find your tutor",
    body: "See who is online now, or filter by subject, price and language. Every profile shows experience, sessions taught and the hourly rate.",
  },
  {
    title: "Pay securely",
    body: `Top up credits, or pay for a single session when you book. ${TRUST_PAYMENT}.`,
  },
  {
    title: "Start or book",
    body: "Request a live tutor and start when they accept, or book a time on their calendar. Your session runs right here in the browser.",
  },
] as const;

/** Three steps and the promise, under the grid (research report 01, finding 5). */
export function HowItWorks() {
  return (
    <section aria-labelledby="how-title" className="space-y-5">
      <h2 id="how-title" className="text-h2 font-semibold text-text">
        How it works
      </h2>
      <ol className="grid gap-4 md:grid-cols-3">
        {STEPS.map((step, i) => (
          <li key={step.title} className="space-y-2 rounded-xl border border-border bg-surface-raised p-5">
            <span
              data-numeric
              className="grid size-8 place-items-center rounded-full bg-surface-muted font-display text-body font-semibold text-text"
            >
              {i + 1}
            </span>
            <h3 className="text-h3 font-semibold text-text">{step.title}</h3>
            <p className="text-body text-text-muted">{step.body}</p>
          </li>
        ))}
      </ol>
      {TRUST_GUARANTEE_CONFIRMED && (
        <p className="text-body font-medium text-text">{TRUST_GUARANTEE}</p>
      )}
    </section>
  );
}

/** The supply side's way in. Links to sign-up, where the tutor role is chosen. */
export function TutorBand() {
  return (
    <section
      aria-labelledby="teach-title"
      className="flex flex-col items-start justify-between gap-4 rounded-xl bg-surface-muted p-6 md:flex-row md:items-center md:p-8"
    >
      <div className="space-y-1">
        <h2 id="teach-title" className="text-h2 font-semibold text-text">
          Teach on NowTutors
        </h2>
        <p className="text-body text-text-muted">
          Go live when you have time, take instant sessions, and get paid for every one you teach.
        </p>
      </div>
      <Button asChild size="lg">
        <Link href="/signup">Become a tutor</Link>
      </Button>
    </section>
  );
}
