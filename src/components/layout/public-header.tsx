"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
import { publicNav } from "@/components/layout/nav-config";

/**
 * The public header: white, one hairline, plain text links, and the only two
 * buttons a signed-out visitor needs. The old ink header (white text on
 * `ink-900` with gold CTAs) went with the ink shell in the design overhaul.
 */
export function PublicHeader() {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur">
      <div className="grid h-16 grid-cols-[auto_1fr_auto] items-center gap-4 px-4 md:px-6">
        <Wordmark href="/" size="sm" />

        <nav className="hidden items-center justify-center gap-1 md:flex" aria-label="Main">
          {publicNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={cn(
                "focus-ring rounded-md px-3 py-2 text-body font-medium transition-colors",
                isActive(item.href)
                  ? "text-text underline decoration-2 underline-offset-8"
                  : "text-text-muted hover:text-text",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center justify-end gap-2">
          <div className="hidden items-center gap-2 md:flex">
            <Button asChild variant="secondary" size="sm">
              <Link href="/login">Log in</Link>
            </Button>
            <Button asChild variant="primary" size="sm">
              <Link href="/signup">Sign up</Link>
            </Button>
          </div>

          {/* Mobile */}
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
                {publicNav.map((item) => (
                  <DrawerClose asChild key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={isActive(item.href) ? "page" : undefined}
                      className={cn(
                        "focus-ring rounded-md px-3 py-2.5 text-body font-medium",
                        isActive(item.href)
                          ? "bg-surface-muted text-text"
                          : "text-text-muted hover:bg-surface-muted hover:text-text",
                      )}
                    >
                      {item.label}
                    </Link>
                  </DrawerClose>
                ))}
                <div className="mt-4 flex flex-col gap-2">
                  <DrawerClose asChild>
                    <Button asChild variant="secondary">
                      <Link href="/login">Log in</Link>
                    </Button>
                  </DrawerClose>
                  <DrawerClose asChild>
                    <Button asChild>
                      <Link href="/signup">Sign up</Link>
                    </Button>
                  </DrawerClose>
                </div>
              </DrawerBody>
            </DrawerContent>
          </Drawer>
        </div>
      </div>
    </header>
  );
}
