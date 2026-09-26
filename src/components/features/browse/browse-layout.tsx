import * as React from "react";

/**
 * The frame home and browse share (DESIGN.md v3 "Public pages"; round 3
 * Part C): the search band full width, then the sidebar beside the main
 * column from `lg`, with the chip row standing in for the sidebar below that.
 * Two routes, one shape: `/` passes fixed queries, `/tutors` the parsed ones.
 */
export function BrowseLayout({
  band,
  sidebar,
  chips,
  children,
}: {
  band: React.ReactNode;
  sidebar: React.ReactNode;
  chips: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      {band}
      <div className="mx-auto w-full max-w-[1360px] px-4 pb-[90px] pt-6 md:px-6 lg:grid lg:grid-cols-[220px_1fr] lg:gap-8">
        <div className="hidden lg:block">
          <div className="sticky top-[72px]">{sidebar}</div>
        </div>
        <div className="min-w-0">
          <div className="mb-5 lg:hidden">{chips}</div>
          {children}
        </div>
      </div>
    </>
  );
}
