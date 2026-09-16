import type * as React from "react";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { SearchX, ShieldCheck } from "lucide-react";
import { db } from "@/db";
import { subjects as subjectsTable } from "@/db/schema";
import {
  parseTutorSearchParams,
  SearchParamError,
  type TutorQuery,
} from "@/lib/tutors/filters";
import {
  browseTutors,
  countBrowseTutors,
  getLiveStrip,
  getSubjectTutorCounts,
} from "@/db/queries/tutors";
import { getViewer } from "@/lib/auth/guards";
import { getUsdPerCredit } from "@/lib/settings";
import { TRUST_GUARANTEE, TRUST_GUARANTEE_CONFIRMED, TRUST_PAYMENT } from "@/lib/copy/trust";
import { TutorCard } from "@/components/features/tutor-card";
import { TutorFilters, TutorFiltersBar } from "@/components/features/tutor-filters";
import { Hero } from "@/components/features/home/hero";
import { SubjectTiles } from "@/components/features/home/subject-tiles";
import { HowItWorks, TutorBand } from "@/components/features/home/how-it-works";
import { EmptyState } from "@/components/ui/empty-state";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { FavouriteMode } from "@/components/features/favourite-heart";

export const dynamic = "force-dynamic"; // reads cookies (viewer) + live-derived data

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function toParams(sp: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (Array.isArray(v)) v.forEach((x) => params.append(k, x));
    else if (v != null) params.append(k, v);
  }
  return params;
}

/** Query keys that change the result set. Anything else (`_t` cache-busters) doesn't count as filtering. */
const RESULT_KEYS = ["subject", "lang", "price", "live", "sort", "minRating", "cursor"];

/**
 * `/` is the browse experience (SPEC §7.2, parity with the Bubble index), and
 * since design overhaul Part 3 it is also the home page: a hero that sells
 * "live right now" sits above the filters and grid, and subject tiles, how it
 * works and the tutor band sit below (DECISIONS, Part 3: one page, not a
 * separate landing page). The hero and the sections below only show on the
 * unfiltered first page, so filtering doesn't push results down.
 * `/tutors` redirects here. Anonymous browsing works.
 */
export default async function BrowsePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const params = toParams(sp);

  // A present-but-invalid filter is rejected loudly, not silently dropped (§3.3).
  // A shared URL with a bad param shows this error rather than wrong results.
  let query: TutorQuery;
  try {
    query = parseTutorSearchParams(params);
  } catch (e) {
    if (e instanceof SearchParamError) {
      return (
        <div className="mx-auto w-full max-w-[1200px] px-4 py-8 md:px-6">
          <Alert variant="danger" title="That link has an invalid filter">
            <p>{e.message}</p>
            <div className="mt-3">
              <Button asChild variant="secondary">
                <Link href="/">Clear filters</Link>
              </Button>
            </div>
          </Alert>
        </div>
      );
    }
    throw e;
  }

  const isLanding = !RESULT_KEYS.some((k) => params.has(k));

  const viewer = await getViewer();
  const [subjectRows, { cards, nextCursor }, total, usdPerCredit, live, subjectCounts] =
    await Promise.all([
      db
        .select({ slug: subjectsTable.slug, name: subjectsTable.name })
        .from(subjectsTable)
        .where(eq(subjectsTable.isActive, true))
        .orderBy(asc(subjectsTable.sortOrder)),
      browseTutors(query, { viewerId: viewer?.userId ?? null }),
      countBrowseTutors(query),
      getUsdPerCredit(),
      isLanding ? getLiveStrip(6) : Promise.resolve(null),
      isLanding ? getSubjectTutorCounts() : Promise.resolve([]),
    ]);

  const favouriteMode: FavouriteMode = !viewer
    ? "anon"
    : viewer.role === "student"
      ? "student"
      : "hidden";
  const currentQs = params.toString();
  const loginHref = `/login?next=${encodeURIComponent(currentQs ? `/?${currentQs}` : "/")}`;

  const nextParams = new URLSearchParams(params);
  if (nextCursor) nextParams.set("cursor", nextCursor);

  const cardProps = { favouriteMode, loginHref, usdPerCredit };
  // The guarantee sits in the grid after the sixth tutor, where a student is
  // deciding (research report 01, "risk reversal"), only once it's agreed.
  const guaranteeAfter = TRUST_GUARANTEE_CONFIRMED && cards.length > 6 ? 6 : -1;

  return (
    <>
      {isLanding && live && <Hero live={live} />}

      <div className="mx-auto w-full max-w-[1200px] space-y-12 px-4 py-8 md:px-6">
        <section id="tutors" aria-labelledby="tutors-title" className="scroll-mt-20 space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            {isLanding ? (
              <h2 id="tutors-title" className="text-h1 font-bold text-text">
                Browse tutors
              </h2>
            ) : (
              <h1 id="tutors-title" className="text-h1 font-bold text-text">
                Find a tutor
              </h1>
            )}
            <p className="inline-flex items-center gap-1.5 text-small text-text-muted">
              <ShieldCheck className="size-4 text-accent" aria-hidden />
              {TRUST_PAYMENT}
            </p>
          </div>

          <TutorFiltersBar subjects={subjectRows} resultCount={total} />

          <div className="grid gap-8 md:grid-cols-[240px_1fr]">
            <aside className="hidden md:block">
              <div className="sticky top-20 rounded-xl border border-border bg-surface-raised p-5">
                <TutorFilters subjects={subjectRows} />
              </div>
            </aside>

            <div>
              {cards.length === 0 ? (
                <EmptyState
                  icon={<SearchX className="size-6" />}
                  title="No tutors match your filters"
                  description="Try removing a filter or widening your price range."
                  action={
                    <Button asChild variant="secondary">
                      <Link href="/">Clear filters</Link>
                    </Button>
                  }
                />
              ) : (
                <>
                  <ul className="hidden gap-4 md:grid md:grid-cols-2 lg:grid-cols-3">
                    {cards.map((tutor, i) => (
                      <GridItem key={tutor.userId} showGuarantee={i === guaranteeAfter}>
                        <TutorCard tutor={tutor} {...cardProps} />
                      </GridItem>
                    ))}
                  </ul>
                  <ul className="grid gap-3 md:hidden">
                    {cards.map((tutor, i) => (
                      <GridItem key={tutor.userId} showGuarantee={i === guaranteeAfter}>
                        <TutorCard tutor={tutor} {...cardProps} variant="row" />
                      </GridItem>
                    ))}
                  </ul>
                  {nextCursor && (
                    <div className="mt-8 flex justify-center">
                      <Button asChild variant="secondary">
                        <Link href={`/?${nextParams.toString()}#tutors`}>Next page</Link>
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </section>

        {isLanding && (
          <>
            <SubjectTiles subjects={subjectCounts} />
            <HowItWorks />
            <TutorBand />
          </>
        )}
      </div>
    </>
  );
}

/** A grid cell, with the guarantee card placed before it when due. */
function GridItem({ showGuarantee, children }: { showGuarantee: boolean; children: React.ReactNode }) {
  return (
    <>
      {showGuarantee && (
        <li className="flex flex-col justify-center gap-2 rounded-xl bg-surface-muted p-6">
          <ShieldCheck className="size-6 text-accent" aria-hidden />
          <p className="font-display text-h3 font-semibold text-text">{TRUST_GUARANTEE}</p>
          <p className="text-small text-text-muted">{TRUST_PAYMENT}.</p>
        </li>
      )}
      <li className="list-none">{children}</li>
    </>
  );
}
