import * as React from "react";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { SearchX } from "lucide-react";
import { db } from "@/db";
import { subjects as subjectsTable } from "@/db/schema";
import {
  parseTutorSearchParams,
  SearchParamError,
  type TutorQuery,
} from "@/lib/tutors/filters";
import { redirect } from "next/navigation";
import { browseHref, matchSubject, toSearchParams } from "@/lib/tutors/browse-url";
import {
  browseTutors,
  countBrowseTutors,
  getLiveTutorCount,
  getSubjectTutorCounts,
} from "@/db/queries/tutors";
import { getViewer } from "@/lib/auth/guards";
import { getUsdPerCredit } from "@/lib/settings";
import { TutorCard } from "@/components/features/tutor-card";
import { ResultSort, TutorFilterChips } from "@/components/features/tutor-filters";
import { EmptyState } from "@/components/ui/empty-state";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { FavouriteMode } from "@/components/features/favourite-heart";
import { BrowseLayout } from "@/components/features/browse/browse-layout";
import { BrowseSidebar } from "@/components/features/browse/browse-sidebar";
import { LiveCarousel } from "@/components/features/browse/live-carousel";
import { SearchBand } from "@/components/features/browse/search-band";
import { TutorGrid } from "@/components/features/browse/tutor-grid";

export const dynamic = "force-dynamic"; // reads cookies (viewer) + live-derived data

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** How many subjects get their own chip below `lg`; the search and the sidebar reach the rest. */
const CHIP_SUBJECTS = 5;

/**
 * `/tutors` is browse (design round 3 Part C, DESIGN.md v3 "Public pages",
 * SPEC §6/§7.2): the blue search band, the sidebar from `lg` (the chip row
 * below), the live row when anyone is live and the filter isn't already "live",
 * then the filtered grid with the count and sort, the promise tile after the
 * third card, and paging. Filters live in the query string, so links are
 * shareable, and `/?filter` links from before the home split land here through
 * the home page's redirect. Anonymous browsing works.
 *
 * E2E contract: the presence spec visits `/tutors?live=1` and counts
 * `a[href^="/tutors/<slug>"]`; every card still links to its profile.
 */
export default async function BrowsePage({ searchParams }: { searchParams: SearchParams }) {
  const params = toSearchParams(await searchParams);

  // `?q=` is free text from the header's search and the app's topbar search.
  // It resolves to a subject here, on the server, the same way the search band
  // does in the browser: a match becomes `?subject=`, and a miss is said out loud.
  let searchMiss: string | null = null;
  const q = params.get("q")?.trim();
  if (params.has("q")) {
    params.delete("q");
    if (q) {
      const active = await db
        .select({ slug: subjectsTable.slug, name: subjectsTable.name })
        .from(subjectsTable)
        .where(eq(subjectsTable.isActive, true));
      const match = matchSubject(q, active);
      if (match) {
        params.delete("subject");
        params.delete("cursor");
        params.append("subject", match.slug);
        redirect(browseHref(params));
      }
      searchMiss = q;
    }
  }

  // A present-but-invalid filter is rejected loudly, not silently dropped (§3.3).
  let query: TutorQuery;
  try {
    query = parseTutorSearchParams(params);
  } catch (e) {
    if (e instanceof SearchParamError) {
      return (
        <div className="mx-auto w-full max-w-[1360px] px-4 py-8 md:px-6">
          <Alert variant="danger" title="That link has an invalid filter">
            <p>{e.message}</p>
            <div className="mt-3">
              <Button asChild variant="outline">
                <Link href="/tutors">Clear filters</Link>
              </Button>
            </div>
          </Alert>
        </div>
      );
    }
    throw e;
  }

  const viewer = await getViewer();
  const viewerId = viewer?.userId ?? null;
  const [subjectRows, { cards, nextCursor }, total, usdPerCredit, subjectCounts, liveCount, live] =
    await Promise.all([
      db
        .select({ slug: subjectsTable.slug, name: subjectsTable.name })
        .from(subjectsTable)
        .where(eq(subjectsTable.isActive, true))
        .orderBy(asc(subjectsTable.sortOrder)),
      browseTutors(query, { viewerId }),
      countBrowseTutors(query),
      getUsdPerCredit(),
      getSubjectTutorCounts(),
      getLiveTutorCount().catch(() => 0),
      // The live row: everyone live, whatever the grid is filtered to. Skipped
      // when the grid itself is the live list, so nobody appears twice.
      query.liveNow
        ? Promise.resolve({ cards: [] })
        : browseTutors(parseTutorSearchParams(new URLSearchParams("live=1")), { viewerId }),
    ]);

  const favouriteMode: FavouriteMode = !viewer
    ? "anon"
    : viewer.role === "student"
      ? "student"
      : "hidden";
  const loginHref = `/login?next=${encodeURIComponent(browseHref(params))}`;

  const nextParams = new URLSearchParams(params);
  if (nextCursor) nextParams.set("cursor", nextCursor);

  const chipSubjects = subjectCounts.slice(0, CHIP_SUBJECTS).map(({ slug, name }) => ({ slug, name }));
  const cardProps = { favouriteMode, loginHref, usdPerCredit };

  return (
    <BrowseLayout
      band={
        <SearchBand
          id="browse-title"
          heading="Browse online tutors"
          subline="Whether you'd like a hand this minute or want to set up regular lessons, there is a tutor here for it."
          subjects={subjectRows}
          initialMiss={searchMiss}
        />
      }
      sidebar={<BrowseSidebar subjects={subjectCounts} />}
      chips={<TutorFilterChips subjects={subjectRows} chipSubjects={chipSubjects} resultCount={total} />}
    >
      <LiveCarousel
        liveCount={liveCount}
        items={live.cards.map((tutor) => (
          <TutorCard key={tutor.userId} tutor={tutor} {...cardProps} />
        ))}
      />

      <section aria-labelledby="browse-results-title">
        <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="browse-results-title" className="font-display text-h2 font-semibold text-text">
            {query.liveNow ? "Live now" : "All tutors"}
          </h2>
          <ResultSort resultCount={total} className="hidden lg:flex" />
        </div>

        {cards.length === 0 ? (
          <EmptyState
            icon={<SearchX className="size-6" />}
            title="No tutors match your filters"
            description="Try removing a filter or widening your price range."
            action={
              <Button asChild variant="outline">
                <Link href="/tutors">Clear filters</Link>
              </Button>
            }
          />
        ) : (
          <>
            <TutorGrid cards={cards} cardProps={cardProps} />
            {nextCursor && (
              <div className="mt-8 flex justify-center">
                <Button asChild variant="outline">
                  <Link href={browseHref(nextParams)}>Next page</Link>
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </BrowseLayout>
  );
}
