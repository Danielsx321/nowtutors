import Link from "next/link";
import { permanentRedirect } from "next/navigation";
import { browseTutors, getLiveTutorCount, type TutorCardData } from "@/db/queries/tutors";
import { getHomeProof, getLiveTutorCountries } from "@/db/queries/dashboard-stats";
import { parseTutorSearchParams } from "@/lib/tutors/filters";
import { shouldRedirectToBrowse, toSearchParams } from "@/lib/tutors/browse-url";
import { countryName, toGlobeMarkers } from "@/lib/geo/country-centroids";
import { getViewer, homeFor } from "@/lib/auth/guards";
import { getUsdPerCredit } from "@/lib/settings";
import { Button } from "@/components/ui/button";
import { TutorCard } from "@/components/features/tutor-card";
import type { FavouriteMode } from "@/components/features/favourite-heart";
import { Hero, type FloatingTutor } from "@/components/features/home/hero";
import { AppFan } from "@/components/features/home/app-fan";
import { SectionHeading } from "@/components/features/home/section-heading";
import { Steps } from "@/components/features/home/steps";
import { ProofWall } from "@/components/features/home/proof-wall";
import { ClosingBlock } from "@/components/features/home/closing-block";

export const dynamic = "force-dynamic"; // live counts, globe dots and the viewer change per request

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const HOME_CARDS = 4;

/**
 * `/` is the home landing (live-globe rebuild Part C, SPEC §6/§7.2; pages.html,
 * Home). Browse moved to `/tutors`. This reverses the 2026-09-16 one-page
 * decision because Daniels approved separate Home and Browse pages on
 * 2026-09-17 (DECISIONS).
 *
 * Old shared links like `/?subject=algebra` were browse links, so any
 * result-changing key forwards to `/tutors` with the query intact.
 *
 * Every number on the page is real: the live count, the globe's dots, the
 * tutors under "ready this minute" (or "Popular tutors" when nobody is live),
 * and the proof wall.
 */
export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const params = toSearchParams(await searchParams);
  const target = shouldRedirectToBrowse(params);
  if (target) permanentRedirect(target);

  const viewer = await getViewer();
  const viewerId = viewer?.userId ?? null;

  const [liveCount, countries, live, proof, usdPerCredit] = await Promise.all([
    getLiveTutorCount().catch(() => 0),
    getLiveTutorCountries().catch(() => [] as string[]),
    browseTutors(parseTutorSearchParams(new URLSearchParams("live=1")), { viewerId }),
    getHomeProof(),
    getUsdPerCredit(),
  ]);

  const anyLiveCards = live.cards.length > 0;
  const cards: TutorCardData[] = anyLiveCards
    ? live.cards.slice(0, HOME_CARDS)
    : (
        await browseTutors(parseTutorSearchParams(new URLSearchParams("sort=most_sessions")), {
          viewerId,
        })
      ).cards.slice(0, HOME_CARDS);

  const floating: FloatingTutor[] = live.cards
    .filter((t) => t.avatarUrl)
    .slice(0, 2)
    .map((t) => ({
      userId: t.userId,
      slug: t.slug,
      name: t.displayName ?? "Tutor",
      avatarUrl: t.avatarUrl!,
      detail: [t.subjects[0], countryName(t.country)].filter(Boolean).join(" · "),
    }));

  const favouriteMode: FavouriteMode = !viewer
    ? "anon"
    : viewer.role === "student"
      ? "student"
      : "hidden";
  const cardProps = { favouriteMode, loginHref: "/login?next=/", usdPerCredit };
  const viewerHome = viewer?.role ? homeFor[viewer.role] : null;

  return (
    <>
      <Hero liveCount={liveCount} markers={toGlobeMarkers(countries)} floating={floating} />
      <AppFan />

      {cards.length > 0 && (
        <section aria-labelledby="home-tutors-title" className="px-4 pb-[clamp(64px,9vw,120px)] md:px-6">
          <div className="mx-auto max-w-[var(--container-page)]">
            <SectionHeading
              id="home-tutors-title"
              kicker={anyLiveCards ? "Live right now" : "Most sessions taught"}
              title={anyLiveCards ? "Tutors ready this minute" : "Popular tutors"}
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href={anyLiveCards ? "/tutors?live=1" : "/tutors"}>See all tutors</Link>
                </Button>
              }
            />
            <ul className="hidden gap-[18px] md:grid md:grid-cols-2 lg:grid-cols-4">
              {cards.map((tutor) => (
                <li key={tutor.userId}>
                  <TutorCard tutor={tutor} {...cardProps} />
                </li>
              ))}
            </ul>
            <ul className="grid gap-3 md:hidden">
              {cards.map((tutor) => (
                <li key={tutor.userId}>
                  <TutorCard tutor={tutor} {...cardProps} variant="row" />
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <Steps />
      <ProofWall proof={proof} />
      <ClosingBlock viewerHome={viewerHome} />
    </>
  );
}
