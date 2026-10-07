import * as React from "react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/**
 * What the content area shows while the next page renders (`loading.tsx` in
 * each area; Daniels, 2026-09-19). The shell around it (sidebar, topbar, site
 * header) stays put, so only the part that is changing waits. A small teal
 * ring rather than a skeleton: the pages differ too much for one skeleton to
 * be honest about any of them. The top bar (`NavigationProgress`) runs at the
 * same time.
 *
 * `site`: the area sits in `SiteShell`, whose footer follows the content. At
 * 50vh the footer showed on screen under the ring and jumped down when the page
 * streamed in (CLS 0.20 on `/tutors` mobile, 2026-10-07). Filling the screen
 * below the 56px header keeps the footer under the fold until the page arrives.
 */
export function PageLoading({ site = false }: { site?: boolean }) {
  return (
    <div
      className={cn(
        "grid place-items-center",
        site ? "min-h-[calc(100dvh-3.5rem)]" : "min-h-[50vh]",
      )}
    >
      <Spinner size="lg" label="Loading page" />
    </div>
  );
}
