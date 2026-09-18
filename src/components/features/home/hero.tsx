import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TutorPhoto } from "@/components/features/tutor-photo";
import { Globe } from "@/components/features/home/globe";
import { ProofStrip } from "@/components/features/home/proof-strip";
import type { GlobeMarker } from "@/lib/geo/country-centroids";
import { cn } from "@/lib/utils";

export interface FloatingTutor {
  userId: string;
  slug: string;
  name: string;
  avatarUrl: string;
  /** "Maths · Ghana" */
  detail: string;
}

/**
 * The top of the home page (live-globe rebuild Part C; pages.html, Home):
 * the live pill with the real count, the headline, the two actions, the
 * turning globe with a dot per country where a tutor is live, and the glass
 * proof strip over the globe's lower half.
 *
 * The two floating cards are real live tutors, shown only when at least two
 * are live and have a photo; otherwise there are none rather than stand-ins.
 */
export function Hero({
  liveCount,
  markers,
  floating,
}: {
  liveCount: number;
  markers: GlobeMarker[];
  floating: FloatingTutor[];
}) {
  const anyLive = liveCount > 0;
  const cards = floating.length >= 2 ? floating.slice(0, 2) : [];

  return (
    <section
      aria-labelledby="hero-title"
      className="relative overflow-hidden rounded-b-[36px] bg-ground px-4 md:px-6"
    >
      <div className="relative z-[3] mx-auto max-w-[var(--container-page)] pt-[clamp(36px,6vw,72px)] text-center">
        <p className="inline-flex flex-wrap items-center justify-center gap-2 rounded-full border border-primary/20 bg-surface-raised/80 py-1.5 pl-2 pr-3.5 text-small font-medium text-text">
          {anyLive ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-live-surface px-2.5 py-0.5 font-semibold text-live">
                <span aria-hidden className="animate-pulse-live size-[7px] rounded-full bg-live" />
                <span data-numeric>{liveCount.toLocaleString()}</span> live
              </span>
              {liveCount === 1 ? "Tutor teaching right now" : "Tutors teaching right now, worldwide"}
            </>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-0.5 font-semibold text-text-muted">
                0 live
              </span>
              Tutors go live throughout the day
            </>
          )}
        </p>

        <h1
          id="hero-title"
          className="mx-auto mb-[18px] mt-[22px] max-w-[22ch] font-display text-[clamp(40px,6.2vw,82px)] font-medium leading-[1.02] tracking-[-0.035em] text-balance text-text"
        >
          Learn from a real tutor in the next minute
        </h1>
        <p className="mx-auto mb-[30px] max-w-[64ch] text-[clamp(16px,1.5vw,19px)] text-text-muted">
          Tutors around the world go live on NowTutors. Pick one, send a request, and start your
          lesson the moment they accept.
        </p>
        <div className="flex flex-wrap justify-center gap-2.5">
          <Button asChild variant="primary">
            <Link href="/tutors?live=1">Find a live tutor</Link>
          </Button>
          <Button asChild variant="highlight">
            <Link href="/tutors">Book for later</Link>
          </Button>
        </div>
      </div>

      {/* The globe is wider than the page on phones and sinks under the strip. */}
      <div className="relative left-1/2 z-[1] -mt-10 mb-[max(-55%,-600px)] w-[min(1100px,130vw)] -translate-x-1/2">
        <Globe markers={markers} className="w-full" />
        {cards.map((t, i) => (
          <FloatingCard key={t.userId} tutor={t} position={i === 0 ? "left" : "right"} />
        ))}
      </div>

      <div className="relative z-[4] mx-auto mb-[clamp(28px,4vw,48px)] max-w-[1000px]">
        <ProofStrip />
      </div>
    </section>
  );
}

function FloatingCard({ tutor, position }: { tutor: FloatingTutor; position: "left" | "right" }) {
  return (
    <Link
      href={`/tutors/${tutor.slug}`}
      className={cn(
        "focus-ring animate-drift absolute z-[3] hidden items-center gap-2.5 rounded-2xl border border-surface-raised bg-surface-raised/90 py-2.5 pl-2.5 pr-3.5 text-left shadow-lift backdrop-blur-md lg:flex",
        position === "left"
          ? "bottom-[36%] left-[max(3%,calc(50%-560px))]"
          : "bottom-[48%] right-[max(3%,calc(50%-560px))] [animation-delay:-3.5s]",
      )}
    >
      <TutorPhoto
        src={tutor.avatarUrl}
        name={tutor.name}
        sizes="38px"
        className="size-[38px] shrink-0 rounded-[11px]"
        initialsClassName="text-small"
      />
      <span className="text-[13px] leading-snug">
        <b className="block font-display text-small font-semibold text-text">{tutor.name} is live</b>
        <span className="text-text-muted">{tutor.detail}</span>
      </span>
    </Link>
  );
}
