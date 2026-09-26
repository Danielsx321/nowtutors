"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Wordmark } from "@/components/layout/wordmark";
import { siteNav } from "@/components/layout/nav-config";

export interface SiteHeaderViewer {
  /** Where this person's signed-in home is: /dashboard, /tutor or /admin. */
  home: string;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * The public header (DESIGN.md v3, design round 3 Part B): a 56px navy bar,
 * which is a dark island (`.theme-dark`), so every role inside it re-resolves
 * and nothing here knows the colour. Wordmark left, two text links with the
 * current one underlined, a subject search on the browse pages, and the two
 * actions on the right: Log in as text, Sign up as the orange act-now fill.
 * Signed in, the actions become the person's avatar and a link to their own
 * home, because a signed-in visitor on a public page is one click from being
 * lost.
 *
 * The search is a plain form to `/tutors?q=`, which the browse page resolves
 * to a subject on the server (Part C of the live-globe rebuild), so it works
 * before any script runs. It shows on `/tutors` itself (home has the search
 * band) and not on a profile, where the panel is the point of the page.
 *
 * Below `md` the links collapse into a menu button holding the same links,
 * the search and the same actions, so nothing is reachable on one width only.
 */
export function SiteHeader({ viewer }: { viewer?: SiteHeaderViewer | null }) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  const isActive = (href: string) => {
    // An anchor into a page is a place on a page, never the page itself.
    if (href.includes("#")) return false;
    const path = href.split(/[?#]/)[0] || "/";
    if (path === "/") return pathname === "/";
    return pathname === path || pathname.startsWith(`${path}/`);
  };
  // Two links share the `/tutors` path: only the one whose query matches the
  // current view is current. The header does not read the query string, so
  // "All tutors" is current on any browse URL and "Live tutors" never is; a
  // student who filtered by live already sees the chip say so.
  const current = (href: string) => isActive(href) && !href.includes("?");

  const showSearch = pathname === "/tutors";

  const linkClass = (href: string) =>
    cn(
      "focus-ring rounded-sm py-[18px] text-small font-medium transition-colors",
      current(href)
        ? "text-text shadow-[inset_0_-2px_0_0_var(--accent)]"
        : "text-text-muted hover:text-text",
    );

  const searchForm = (
    <form
      role="search"
      action="/tutors"
      method="get"
      className="flex h-9 w-full max-w-[340px] items-center gap-2 rounded-full bg-surface-raised px-3.5 text-text-muted"
    >
      <Search aria-hidden="true" className="size-4 shrink-0" />
      <input
        type="search"
        name="q"
        aria-label="Search subjects"
        placeholder="Search subjects, e.g. Algebra"
        className="min-w-0 flex-1 bg-transparent text-small text-text placeholder:text-text-muted focus:outline-none"
      />
    </form>
  );

  return (
    <header className="theme-dark sticky z-40 bg-ground text-text [top:env(safe-area-inset-top,0px)]">
      <div className="mx-auto flex h-14 max-w-[1360px] items-center gap-6 px-4 md:px-6">
        <Wordmark href="/" size="sm" tone="onDark" />

        <nav aria-label="Main" className="hidden items-center gap-5 md:flex">
          {siteNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={current(item.href) ? "page" : undefined}
              className={linkClass(item.href)}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {showSearch && <div className="hidden flex-1 md:flex">{searchForm}</div>}

        <div className="ml-auto flex items-center justify-end gap-2">
          {viewer ? (
            <Button asChild variant="highlight" size="sm" className="hidden md:inline-flex">
              <Link href={viewer.home} className="gap-2">
                <Avatar
                  name={viewer.displayName}
                  src={viewer.avatarUrl ?? undefined}
                  size="sm"
                />
                Dashboard
              </Link>
            </Button>
          ) : (
            <div className="hidden items-center gap-1 md:flex">
              <Button asChild variant="ghost" size="sm">
                <Link href="/login">Log in</Link>
              </Button>
              <Button asChild variant="highlight" size="sm">
                <Link href="/signup">Sign up</Link>
              </Button>
            </div>
          )}

          <Drawer open={open} onOpenChange={setOpen}>
            <DrawerTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                <Menu />
              </Button>
            </DrawerTrigger>
            <DrawerContent className="theme-dark">
              <DrawerHeader>
                <DrawerTitle>Menu</DrawerTitle>
              </DrawerHeader>
              <DrawerBody className="flex flex-col gap-1">
                <div className="mb-3">{searchForm}</div>
                {siteNav.map((item) => (
                  <DrawerClose asChild key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={current(item.href) ? "page" : undefined}
                      className={cn(
                        "focus-ring rounded-lg px-3 py-2.5 text-body font-medium",
                        current(item.href)
                          ? "bg-surface-raised text-text"
                          : "text-text-muted hover:bg-surface-raised hover:text-text",
                      )}
                    >
                      {item.label}
                    </Link>
                  </DrawerClose>
                ))}
                <div className="mt-4 flex flex-col gap-2">
                  {viewer ? (
                    <DrawerClose asChild>
                      <Button asChild variant="highlight">
                        <Link href={viewer.home}>Dashboard</Link>
                      </Button>
                    </DrawerClose>
                  ) : (
                    <>
                      <DrawerClose asChild>
                        <Button asChild variant="outline">
                          <Link href="/login">Log in</Link>
                        </Button>
                      </DrawerClose>
                      <DrawerClose asChild>
                        <Button asChild variant="highlight">
                          <Link href="/signup">Sign up</Link>
                        </Button>
                      </DrawerClose>
                    </>
                  )}
                </div>
              </DrawerBody>
            </DrawerContent>
          </Drawer>
        </div>
      </div>
    </header>
  );
}
