import Link from "next/link";
import { permanentRedirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { subjects as subjectsTable } from "@/db/schema";
import {
  browseTutors,
  getLiveTutorCount,
  getSubjectTutorCounts,
  type TutorCardData,
} from "@/db/queries/tutors";
import { parseTutorSearchParams } from "@/lib/tutors/filters";
import { shouldRedirectToBrowse, toSearchParams } from "@/lib/tutors/browse-url";
import { getViewer } from "@/lib/auth/guards";
import { getUsdPerCredit } from "@/lib/settings";
import { Button } from "@/components/ui/button";
import { TutorCard } from "@/components/features/tutor-card";
import type { FavouriteMode } from "@/components/features/favourite-heart";
import { TutorFilterChips } from "@/components/features/tutor-filters";
import { BrowseLayout } from "@/components/features/browse/browse-layout";
import { BrowseSidebar } from "@/components/features/browse/browse-sidebar";
import { LiveCarousel } from "@/components/features/browse/live-carousel";
import { SearchBand } from "@/components/features/browse/search-band";
import { TutorGrid } from "@/components/features/browse/tutor-grid";

export const dynamic = "force-dynamic"; // live counts and the viewer change per request

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Cards on the home grid before "See all tutors". */
const HOME_CARDS = 8;

/**
 * `/` is home (design round 3 Part C, DESIGN.md v3 "Public pages"): the same
 * shape as browse, after Oranum. The blue search band, the sidebar from `lg`,
 * the tutors who are live this minute in a row, and the most-taught tutors in
 * the grid with a link to everyone. Browse itself is `/tutors`.
 *
 * Old shared links like `/?subject=algebra` were browse links, so any
 * result-changing key forwards to `/tutors` with the query intact. The
 * sidebar and the chip row write to this same URL, so their first click lands
 * on browse through that forward.
 *
 * The v2 home (globe hero, app-screens fan, steps, proof wall, closing block)
 * is parked, not deleted: `components/features/home/*` (DECISIONS, round 3
 * Part C).
 */
export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const params = toSearchParams(await searchParams);
  const target = shouldRedirectToBrowse(params);
  if (target) permanentRedirect(target);

  const viewer = await getViewer();
  const viewerId = viewer?.userId ?? null;

  const [liveCount, live, popular, subjectRows, subjectCounts, usdPerCredit] = await Promise.all([
    getLiveTutorCount().catch(() => 0),
    browseTutors(parseTutorSearchParams(new URLSearchParams("live=1")), { viewerId }),
    browseTutors(parseTutorSearchParams(new URLSearchParams("sort=most_sessions")), { viewerId }),
    db
      .select({ slug: subjectsTable.slug, name: subjectsTable.name })
      .from(subjectsTable)
      .where(eq(subjectsTable.isActive, true))
      .orderBy(asc(subjectsTable.sortOrder)),
    getSubjectTutorCounts(),
    getUsdPerCredit(),
  ]);

  const cards: TutorCardData[] = popular.cards.slice(0, HOME_CARDS);
  const favouriteMode: FavouriteMode = !viewer
    ? "anon"
    : viewer.role === "student"
      ? "student"
      : "hidden";
  const cardProps = { favouriteMode, loginHref: "/login?next=/", usdPerCredit };
  const chipSubjects = subjectCounts.slice(0, 5).map(({ slug, name }) => ({ slug, name }));

  return (
    <BrowseLayout
      band={
        <SearchBand
          id="home-title"
          heading="Your personal tutor, any time, anywhere"
          subline="Book a lesson for later, or start one with a tutor who is live this minute."
          subjects={subjectRows}
        />
      }
      sidebar={<BrowseSidebar subjects={subjectCounts} />}
      chips={<TutorFilterChips subjects={subjectRows} chipSubjects={chipSubjects} resultCount={popular.cards.length} />}
    >
      <LiveCarousel
        liveCount={liveCount}
        items={live.cards.map((tutor) => (
          <TutorCard key={tutor.userId} tutor={tutor} {...cardProps} />
        ))}
      />

      <section aria-labelledby="home-tutors-title">
        <div className="mb-3.5 flex items-baseline justify-between gap-3">
          <h2 id="home-tutors-title" className="font-display text-h2 font-semibold text-text">
            All tutors
          </h2>
          <Button asChild variant="ghost" size="sm" className="text-accent">
            <Link href="/tutors">See all tutors</Link>
          </Button>
        </div>
        {cards.length > 0 ? (
          <TutorGrid cards={cards} cardProps={cardProps} />
        ) : (
          <p className="text-body text-text-muted">No tutors yet. Check back soon.</p>
        )}
      </section>
    </BrowseLayout>
  );
}
