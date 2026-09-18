import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * The teal closing block above the footer (pages.html, Home). The faces are
 * the Unsplash marketing photos bundled in `public/images/home` (DECISIONS,
 * Part C), not tutors on the platform, so they carry no names.
 *
 * A signed-in visitor already has an account, so "Get started" becomes a way
 * back to their own home.
 */
const FACES = [
  "/images/home/tutor-sofia.jpg",
  "/images/home/tutor-kwame.jpg",
  "/images/home/tutor-marco.jpg",
  "/images/home/student-tobi.jpg",
];

export function ClosingBlock({ viewerHome }: { viewerHome: string | null }) {
  return (
    <section aria-labelledby="closing-title" className="px-4 pb-5 md:px-6">
      <div className="mx-auto grid max-w-[var(--container-page)] items-center gap-7 rounded-[32px] bg-primary p-[clamp(32px,6vw,72px)] text-on-primary min-[900px]:grid-cols-[1.2fr_0.8fr]">
        <div>
          <h2
            id="closing-title"
            className="mb-3.5 font-display text-[clamp(36px,5vw,64px)] font-medium leading-[1.02] tracking-[-0.035em]"
          >
            Your next lesson is a minute away.
          </h2>
          <p className="mb-6 max-w-[44ch] text-body-lg text-on-primary/75">
            Free to join. See who&apos;s live and only pay when your tutor accepts.
          </p>
          <div className="flex flex-wrap gap-2.5">
            <Button asChild variant="highlight">
              {viewerHome ? (
                <Link href={viewerHome}>Go to your dashboard</Link>
              ) : (
                <Link href="/signup">Get started</Link>
              )}
            </Button>
            <Button
              asChild
              variant="outline"
              className="border-on-primary/45 bg-transparent text-on-primary hover:bg-on-primary/10"
            >
              <Link href="/signup">Teach on NowTutors</Link>
            </Button>
          </div>
        </div>
        <div aria-hidden>
          <div className="flex justify-center">
            {FACES.map((src, i) => (
              <div
                key={src}
                className={
                  "relative aspect-square w-[clamp(80px,11vw,130px)] overflow-hidden rounded-full border-4 border-primary" +
                  (i > 0 ? " -ml-[26px]" : "")
                }
              >
                <Image src={src} alt="" fill sizes="130px" className="object-cover" />
              </div>
            ))}
          </div>
          <div className="mt-[18px] flex justify-center gap-2.5">
            <i className="block size-2.5 rounded-full bg-spark" />
            <i className="block size-2.5 rounded-full bg-spark" />
            <i className="block size-2.5 rounded-full bg-spark" />
          </div>
        </div>
      </div>
    </section>
  );
}
