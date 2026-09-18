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
import { browseHref, toSearchParams } from "@/lib/tutors/browse-url";
import { browseTutors, countBrowseTutors, getSubjectTutorCounts } from "@/db/queries/tutors";
import { getViewer } from "@/lib/auth/guards";
import { getUsdPerCredit } from "@/lib/settings";
import { TRUST_GUARANTEE, TRUST_GUARANTEE_CONFIRMED, TRUST_PAYMENT } from "@/lib/copy/trust";
import { TutorCard } from "@/components/features/tutor-card";
import { SubjectSearch, TutorFilterChips } from "@/components/features/tutor-filters";
import { EmptyState } from "@/components/ui/empty-state";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { FavouriteMode } from "@/components/features/favourite-heart";

export const dynamic = "force-dynamic"; // reads cookies (viewer) + live-derived data

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** How many subjects get their own chip; the search pill reaches the rest. */
const CHIP_SUBJECTS = 5;

/** The promise tile sits after this many cards, where a student is deciding (pages.html, Browse). */
const PROMISE_AFTER = 3;

/**
 * `/tutors` is browse (live-globe rebuild Part C, SPEC §6/§7.2; pages.html,
 * Browse): search pill, filter chips led by Live now, the count and sort, and
 * the card grid with the no-show promise after the third card. Filters live in
 * the query string, so links are shareable, and `/?filter` links from before
 * Part C land here through the home page's redirect. Anonymous browsing works.
 *
 * E2E contract: the presence spec visits `/tutors?live=1` and counts
 * `a[href^="/tutors/<slug>"]`; every card still links to its profile.
 */
export default async function BrowsePage({ searchParams }: { searchParams: SearchParams }) {
  const params = toSearchParams(await searchParams);

  // A present-but-invalid filter is rejected loudly, not silently dropped (§3.3).
  let query: TutorQuery;
  try {
    query = parseTutorSearchParams(params);
  } catch (e) {
    if (e instanceof SearchParamError) {
      return (
        <div className="mx-auto w-full max-w-[var(--container-page)] px-4 py-8 md:px-6">
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
  const [subjectRows, { cards, nextCursor }, total, usdPerCredit, subjectCounts] = await Promise.all([
    db
      .select({ slug: subjectsTable.slug, name: subjectsTable.name })
      .from(subjectsTable)
      .where(eq(subjectsTable.isActive, true))
      .orderBy(asc(subjectsTable.sortOrder)),
    browseTutors(query, { viewerId: viewer?.userId ?? null }),
    countBrowseTutors(query),
    getUsdPerCredit(),
    getSubjectTutorCounts(),
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
  const promiseAfter = TRUST_GUARANTEE_CONFIRMED && cards.length > PROMISE_AFTER ? PROMISE_AFTER : -1;

  return (
    <div className="mx-auto w-full max-w-[var(--container-page)] px-4 pb-[90px] pt-5 md:px-6">
      <section aria-labelledby="browse-title">
        <span className="mb-3 block text-small font-semibold uppercase tracking-[0.12em] text-accent">
          Find a tutor
        </span>
        <h1
          id="browse-title"
          className="mb-[22px] font-display text-[clamp(30px,3.6vw,46px)] font-medium leading-[1.05] tracking-[-0.03em] text-text"
        >
          Who do you want to learn with?
        </h1>

        <SubjectSearch subjects={subjectRows} />

        <div className="mb-[22px] mt-6">
          <TutorFilterChips subjects={subjectRows} chipSubjects={chipSubjects} resultCount={total} />
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
            <ul className="hidden gap-[18px] md:grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {cards.map((tutor, i) => (
                <GridItem key={tutor.userId} showPromise={i === promiseAfter}>
                  <TutorCard tutor={tutor} {...cardProps} />
                </GridItem>
              ))}
            </ul>
            <ul className="grid gap-3 md:hidden">
              {cards.map((tutor, i) => (
                <GridItem key={tutor.userId} showPromise={i === promiseAfter}>
                  <TutorCard tutor={tutor} {...cardProps} variant="row" />
                </GridItem>
              ))}
            </ul>
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
    </div>
  );
}

/** A grid cell, with the teal promise tile placed before it when due. */
function GridItem({ showPromise, children }: { showPromise: boolean; children: React.ReactNode }) {
  return (
    <>
      {showPromise && (
        <li className="flex flex-col justify-between gap-4 rounded-card bg-primary p-6 text-on-primary">
          <b className="font-display text-[28px] font-medium leading-[1.1] tracking-[-0.02em]">
            {TRUST_GUARANTEE}
          </b>
          <p className="text-small text-on-primary/75">
            The no-show promise on every session · {TRUST_PAYMENT}
          </p>
        </li>
      )}
      <li className="list-none">{children}</li>
    </>
  );
}
