"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * A thin teal bar across the top of the window while the next page loads
 * (Daniels, 2026-09-19: "when you click there is no indication, it just waits
 * and then switches"). Every page here is rendered on the server per request,
 * so a click can sit for a second or more with nothing visible happening.
 *
 * How it works, with no library: a click on an in-app link (or a GET form
 * submit) starts the bar, which creeps towards 90% and never reaches the end
 * on its own; the route actually changing (pathname or query) finishes it.
 * If nothing changes within 12 seconds, it quietly gives up rather than
 * sitting there forever. `loading.tsx` in each area shows a spinner in the
 * content at the same time, so there are two signals: one at the edge of the
 * eye, one where the person is looking.
 *
 * Decorative for assistive tech (`aria-hidden`): the content-area spinner
 * carries `role="status"`. Under reduced motion the global rule removes the
 * transitions, so the bar steps instead of sliding.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [progress, setProgress] = React.useState<number | null>(null);
  const timers = React.useRef<{ trickle?: ReturnType<typeof setInterval>; giveUp?: ReturnType<typeof setTimeout>; hide?: ReturnType<typeof setTimeout> }>({});

  const clear = React.useCallback(() => {
    const t = timers.current;
    if (t.trickle) clearInterval(t.trickle);
    if (t.giveUp) clearTimeout(t.giveUp);
    if (t.hide) clearTimeout(t.hide);
    timers.current = {};
  }, []);

  const start = React.useCallback(() => {
    clear();
    setProgress(8);
    timers.current.trickle = setInterval(() => {
      // Slower the further it gets, so it never looks finished before it is.
      setProgress((p) => (p === null ? null : Math.min(90, p + (90 - p) * 0.12)));
    }, 200);
    timers.current.giveUp = setTimeout(() => {
      clear();
      setProgress(null);
    }, 12_000);
  }, [clear]);

  const finish = React.useCallback(() => {
    if (timers.current.trickle) clearInterval(timers.current.trickle);
    if (timers.current.giveUp) clearTimeout(timers.current.giveUp);
    setProgress((p) => (p === null ? null : 100));
    timers.current.hide = setTimeout(() => setProgress(null), 250);
  }, []);

  // The route changed: whatever was loading has arrived.
  const routeKey = `${pathname}?${searchParams.toString()}`;
  const firstRoute = React.useRef(routeKey);
  React.useEffect(() => {
    if (routeKey === firstRoute.current) return;
    firstRoute.current = routeKey;
    finish();
  }, [routeKey, finish]);

  React.useEffect(() => {
    const isInternalNavigation = (url: URL) =>
      url.origin === window.location.origin &&
      (url.pathname !== window.location.pathname || url.search !== window.location.search);

    const onClick = (e: MouseEvent) => {
      // No defaultPrevented check: Next's <Link> always prevents the default
      // (it navigates client-side), so this listens in the capture phase,
      // before Link's own handler, and judges the link itself instead.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      let url: URL;
      try {
        url = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (isInternalNavigation(url)) start();
    };

    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement | null;
      if (!form || (form.method || "get").toLowerCase() !== "get" || !form.getAttribute("action")) return;
      try {
        if (isInternalNavigation(new URL(form.action, window.location.href))) start();
      } catch {
        /* not a URL we can reason about */
      }
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      clear();
    };
  }, [start, clear]);

  if (progress === null) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px]">
      <div
        data-nav-progress
        className="h-full bg-primary transition-[width,opacity] duration-200 ease-out"
        style={{ width: `${progress}%`, opacity: progress >= 100 ? 0 : 1 }}
      />
    </div>
  );
}
