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
import { publicNav } from "@/components/layout/nav-config";

function Wordmark() {
  return (
    <Link href="/" className="focus-ring-on-ink rounded-sm text-h3 font-bold text-white">
      Now<span className="text-gold-400">Tutors</span>
    </Link>
  );
}

export function PublicHeader() {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-40 border-b border-ink-700 bg-ink-900/95 backdrop-blur">
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <div className="flex items-center gap-8">
          <Wordmark />
          <nav className="hidden items-center gap-1 md:flex">
            {publicNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={cn(
                  "focus-ring-on-ink rounded-md px-3 py-2 text-body font-medium transition-colors",
                  isActive(item.href)
                    ? "text-gold-400"
                    : "text-white hover:text-ink-300",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <Button asChild variant="ink-ghost" size="sm">
            <Link href="/login">Log in</Link>
          </Button>
          <Button asChild variant="ink" size="sm">
            <Link href="/signup">Sign up</Link>
          </Button>
        </div>

        {/* Mobile */}
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerTrigger asChild>
            <Button variant="ink-ghost" size="icon" className="md:hidden" aria-label="Open menu">
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
                    className={cn(
                      "focus-ring rounded-md px-3 py-2.5 text-body font-medium",
                      isActive(item.href)
                        ? "bg-purple-100 text-purple-700"
                        : "text-gray-700 hover:bg-gray-50",
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
    </header>
  );
}
