import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LiveChip } from "@/components/ui/live-chip";
import { TutorPhoto } from "@/components/features/tutor-photo";
import type { LiveStrip } from "@/db/queries/tutors";

/**
 * The top of `/` (design overhaul Part 3). It sells "now": the one thing no
 * competitor can show is a real count of tutors live right now, with their
 * faces (research report 01, finding 5). The numbers come from `live_tutors`
 * and nothing is padded: zero live tutors says so and points to booking.
 * Sits directly above the tutor grid, so a returning student is one scroll
 * from tutors (DECISIONS, Part 3: `/` stays the browse page).
 */
export function Hero({ live }: { live: LiveStrip }) {
  const anyLive = live.count > 0;
  return (
    <section aria-labelledby="hero-title" className="border-b border-border bg-surface">
      <div className="mx-auto grid max-w-[1200px] gap-8 px-4 py-10 md:grid-cols-[1.2fr_1fr] md:items-center md:px-6 md:py-14">
        <div className="space-y-5">
          <h1
            id="hero-title"
            className="font-display text-[40px] font-bold leading-[44px] tracking-tight text-text md:text-[56px] md:leading-[60px]"
          >
            A real tutor, live, right now.
          </h1>
          <p className="max-w-xl text-body-lg text-text-muted">
            Pick a tutor who is online, send a request, and start your session as soon as they
            accept. Or book a time that suits you.
          </p>
          <div className="flex flex-wrap gap-3">
            {anyLive ? (
              <Button asChild variant="live" size="lg">
                <Link href="/?live=1#tutors">See who&apos;s live</Link>
              </Button>
            ) : null}
            <Button asChild variant={anyLive ? "secondary" : "primary"} size="lg">
              <Link href="#tutors">Browse all tutors</Link>
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface-muted p-5">
          {anyLive ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <LiveChip />
                <p data-numeric className="text-small text-text-muted">
                  <span className="font-display text-h3 font-semibold text-text">
                    {live.count.toLocaleString()}
                  </span>{" "}
                  {live.count === 1 ? "tutor" : "tutors"} online
                </p>
              </div>
              <ul className="mt-4 grid grid-cols-3 gap-3">
                {live.faces.map((t) => {
                  const name = t.displayName ?? "Tutor";
                  return (
                    <li key={t.userId}>
                      <Link
                        href={`/tutors/${t.slug}`}
                        className="focus-ring group block rounded-lg"
                      >
                        <TutorPhoto
                          src={t.avatarUrl}
                          name={name}
                          sizes="120px"
                          className="aspect-square w-full ring-2 ring-live ring-offset-2 ring-offset-surface-muted"
                          initialsClassName="text-h2"
                        />
                        <span className="mt-1.5 block truncate text-small font-medium text-text group-hover:underline">
                          {name}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <div className="space-y-2">
              <p className="font-display text-h3 font-semibold text-text">
                No tutors are live this minute.
              </p>
              <p className="text-body text-text-muted">
                Tutors go live throughout the day. Book a session for later, or check back soon.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
