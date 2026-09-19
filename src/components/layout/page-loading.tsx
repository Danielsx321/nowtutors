import { Spinner } from "@/components/ui/spinner";

/**
 * What the content area shows while the next page renders (`loading.tsx` in
 * each area; Daniels, 2026-09-19). The shell around it (sidebar, topbar, site
 * header) stays put, so only the part that is changing waits. A small teal
 * ring rather than a skeleton: the pages differ too much for one skeleton to
 * be honest about any of them. The top bar (`NavigationProgress`) runs at the
 * same time.
 */
export function PageLoading() {
  return (
    <div className="grid min-h-[50vh] place-items-center">
      <Spinner size="lg" label="Loading page" />
    </div>
  );
}
