import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { subjects as subjectsTable } from "@/db/schema";
import { parseTutorSearchParams } from "@/lib/tutors/filters";
import { browseTutors } from "@/db/queries/tutors";
import { getViewer } from "@/lib/auth/guards";
import { TutorCard } from "@/components/features/tutor-card";
import {
  TutorFilters,
  TutorFiltersBar,
} from "@/components/features/tutor-filters";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { SearchX } from "lucide-react";
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

/**
 * `/` is the browse experience (SPEC §7.2, parity with the Bubble index): a
 * filter rail + tutor grid. `/tutors` redirects here. Anonymous browsing works.
 */
export default async function BrowsePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const params = toParams(sp);
  const query = parseTutorSearchParams(params);

  const [viewer, subjectRows] = await Promise.all([
    getViewer(),
    db
      .select({ slug: subjectsTable.slug, name: subjectsTable.name })
      .from(subjectsTable)
      .where(eq(subjectsTable.isActive, true))
      .orderBy(asc(subjectsTable.sortOrder)),
  ]);

  const { cards, nextCursor } = await browseTutors(query, {
    viewerId: viewer?.userId ?? null,
  });

  const favouriteMode: FavouriteMode = !viewer
    ? "anon"
    : viewer.role === "student"
      ? "student"
      : "hidden";
  const currentQs = params.toString();
  const loginHref = `/login?next=${encodeURIComponent(currentQs ? `/?${currentQs}` : "/")}`;

  const nextParams = new URLSearchParams(params);
  if (nextCursor) nextParams.set("cursor", nextCursor);

  return (
    <div className="container-page py-8">
      <div className="mb-6">
        <h1 className="text-h1 font-bold text-gray-700">Find a tutor</h1>
        <p className="mt-1 text-body text-gray-500">
          Browse {cards.length}
          {nextCursor ? "+" : ""} tutors and start learning.
        </p>
      </div>

      <TutorFiltersBar subjects={subjectRows} resultCount={cards.length} />

      <div className="mt-4 grid gap-8 md:grid-cols-[260px_1fr]">
        <aside className="hidden md:block">
          <div className="sticky top-20">
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
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {cards.map((tutor) => (
                  <TutorCard
                    key={tutor.userId}
                    tutor={tutor}
                    favouriteMode={favouriteMode}
                    loginHref={loginHref}
                  />
                ))}
              </div>
              {nextCursor && (
                <div className="mt-8 flex justify-center">
                  <Button asChild variant="secondary">
                    <Link href={`/?${nextParams.toString()}`}>Next page</Link>
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
