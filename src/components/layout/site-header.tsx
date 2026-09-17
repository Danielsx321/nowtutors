"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
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
 * The public header (DESIGN.md v2): wordmark left, a pill nav in the middle
 * with the current page as a teal pill, and the two actions on the right.
 * Signed in, the actions become the person's avatar and a link to their own
 * home, because a signed-in visitor on a public page is one click from being
 * lost.
 *
 * Below `md` the pill nav collapses into a menu button holding the same links
 * and the same actions, so nothing is reachable on one width only.
 */
export function SiteHeader({ viewer }: { viewer?: SiteHeaderViewer | null }) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  const isActive = (href: string) => {
    const path = href.split(/[?#]/)[0] || "/";
    if (path === "/") return pathname === "/";
    return pathname === path || pathname.startsWith(`${path}/`);
  };

  return (
    <header className="sticky z-40 border-b border-border bg-ground/90 backdrop-blur [top:env(safe-area-inset-top,0px)]">
      <div className="mx-auto flex h-[72px] max-w-[var(--container-page)] items-center justify-between gap-4 px-4 md:px-6">
        <Wordmark href="/" size="sm" />

        <nav
          aria-label="Main"
          className="hidden items-center gap-1 rounded-full border border-border bg-surface-raised/70 p-[5px] md:flex"
        >
          {siteNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={cn(
                "focus-ring rounded-full px-4 py-2 text-small font-medium transition-colors",
                isActive(item.href)
                  ? "bg-primary text-on-primary"
                  : "text-text-muted hover:bg-surface-muted hover:text-text",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center justify-end gap-2">
          {viewer ? (
            <Button asChild variant="primary" size="sm" className="hidden md:inline-flex">
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
            <div className="hidden items-center gap-2 md:flex">
              <Button asChild variant="outline" size="sm">
                <Link href="/login">Log in</Link>
              </Button>
              <Button asChild variant="primary" size="sm">
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
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>Menu</DrawerTitle>
              </DrawerHeader>
              <DrawerBody className="flex flex-col gap-1">
                {siteNav.map((item) => (
                  <DrawerClose asChild key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={isActive(item.href) ? "page" : undefined}
                      className={cn(
                        "focus-ring rounded-lg px-3 py-2.5 text-body font-medium",
                        isActive(item.href)
                          ? "bg-primary text-on-primary"
                          : "text-text-muted hover:bg-surface-muted hover:text-text",
                      )}
                    >
                      {item.label}
                    </Link>
                  </DrawerClose>
                ))}
                <div className="mt-4 flex flex-col gap-2">
                  {viewer ? (
                    <DrawerClose asChild>
                      <Button asChild variant="primary">
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
                        <Button asChild variant="primary">
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
