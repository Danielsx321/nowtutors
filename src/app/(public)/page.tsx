import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LivePill } from "@/components/ui/live-pill";

/**
 * Landing placeholder. The real hero, live-now strip, and subject grid (SPEC
 * §6) are built in Phase 3 — this Phase 2 version just exercises the public
 * shell and a couple of primitives.
 */
export default function Home() {
  return (
    <section className="bg-ink-900">
      <div className="container-page flex flex-col items-center gap-6 py-24 text-center">
        <LivePill label="Now in Phase 2" />
        <h1 className="text-display font-bold text-white">
          Learn anything, <span className="text-gold-400">live</span>.
        </h1>
        <p className="max-w-md text-body-lg text-gray-200">
          The design system is in place. The full marketplace — browse, book,
          and go live — arrives in the phases ahead.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/tutors">Find a tutor</Link>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <Link href="/dev/kitchen-sink">View the design system</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
