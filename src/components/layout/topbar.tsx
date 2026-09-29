"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { itemIsActive, mobileNavByRole, type Role } from "@/components/layout/nav-config";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { CreditBalance } from "@/components/ui/credit-balance";
import { UnreadMessagesLink } from "@/components/features/messaging/unread-messages-link";
import { GoLiveToggle } from "@/components/features/tutor/go-live-toggle";
import { signOut } from "@/actions/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface TopbarProps {
  /** Picks the section tabs. Omitted (kitchen sink, tests): no tabs. */
  role?: Role;
  title?: string;
  /** Opens the mobile nav drawer (the More sheet). */
  onOpenMenu?: () => void;
  showCredits?: boolean;
  credits?: number;
  userName?: string;
  avatarUrl?: string | null;
  /** The viewer's inbox. When set, the Messages icon and unread badge render. */
  messagesHref?: string;
  /**
   * Tutors only: the go-live switch rides in the topbar so it is reachable from
   * every tutor page, not only `/tutor` (SPEC §7.5).
   */
  goLive?: { initialLive: boolean; broadcastHref: string | null };
  /** Account-menu links for this role. Only routes that exist are passed in. */
  accountLinks?: { label: string; href: string }[];
  /**
   * The search pill (pages.html `.topbar .search`). Students search tutors:
   * the form GETs `/tutors?q=`, which browse resolves to a subject. Parts F and
   * G give tutors and admins their own searches; until then they get none.
   */
  search?: { action: string; placeholder: string } | null;
}

/**
 * The bar above the content. Navy, like the public site header (Daniels,
 * 2026-09-29): it is a `.theme-dark` island, so every role inside it
 * re-resolves and the controls need no dark variants of their own.
 *
 * Left, from `lg`: the area's main sections as tabs (the bottom bar's four,
 * so phone and desktop agree on what "main" means), the current one marked
 * with the header's underline. Then the search pill when the role has one
 * (the page title otherwise). Right: the go-live switch for tutors, the
 * credit pill for students, the Messages circle with its unread count, and
 * the avatar with the person's name, which opens the account menu.
 */
export function Topbar({
  role,
  title,
  onOpenMenu,
  showCredits,
  credits = 0,
  userName = "Guest",
  avatarUrl = null,
  messagesHref,
  goLive,
  accountLinks = [],
  search = null,
}: TopbarProps) {
  return (
    <header className="theme-dark sticky top-0 z-30 flex h-16 items-center gap-3 bg-ground px-4 text-text md:h-[76px] md:px-[clamp(16px,2.4vw,30px)]">
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 md:hidden"
        aria-label="Open menu"
        onClick={onOpenMenu}
      >
        <Menu />
      </Button>

      {role ? <SectionTabs role={role} /> : null}

      {search ? (
        <form action={search.action} role="search" className="min-w-0 flex-1">
          <label className="flex h-[50px] items-center gap-2.5 rounded-full border border-border bg-surface-raised px-[18px] text-text-muted focus-within:border-primary">
            <Search className="size-5 shrink-0" aria-hidden strokeWidth={1.75} />
            <span className="sr-only">Search</span>
            <input
              name="q"
              type="search"
              placeholder={search.placeholder}
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-body text-text outline-none placeholder:text-text-muted"
            />
          </label>
        </form>
      ) : (
        <div className="min-w-0 flex-1">
          {title && <h1 className="truncate font-display text-h3 font-semibold text-text">{title}</h1>}
        </div>
      )}

      <div className="flex shrink-0 items-center gap-2 md:gap-3">
        {goLive && (
          <GoLiveToggle
            variant="compact"
            initialLive={goLive.initialLive}
            broadcastHref={goLive.broadcastHref}
          />
        )}
        {showCredits && <CreditBalance credits={credits} className="hidden sm:inline-flex" />}
        {messagesHref && <UnreadMessagesLink href={messagesHref} />}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="focus-ring flex items-center gap-2.5 rounded-full md:border-l md:border-border md:pl-3"
              // Starts with the visible name, so voice control ("click Elizabeth")
              // and the screen-reader name agree (Lighthouse label-content-name-mismatch).
              aria-label={`${userName}, account menu`}
            >
              <Avatar src={avatarUrl ?? undefined} name={userName} size="md" className="md:size-11" />
              <span className="hidden max-w-[14ch] truncate text-body font-semibold text-text lg:inline">
                {userName}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{userName}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {accountLinks.map((link) => (
              <DropdownMenuItem key={link.href} asChild>
                <Link href={link.href}>{link.label}</Link>
              </DropdownMenuItem>
            ))}
            {accountLinks.length > 0 && <DropdownMenuSeparator />}
            <form action={signOut}>
              <DropdownMenuItem asChild destructive>
                <button type="submit" className="w-full">
                  Log out
                </button>
              </DropdownMenuItem>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

/**
 * The area's main sections, from `lg` (the sidebar is an icon rail below it,
 * and phones have the bottom bar). Same underline as the site header's
 * current link: a 2px inset line in `accent` along the bar's bottom edge.
 */
function SectionTabs({ role }: { role: Role }) {
  const pathname = usePathname() ?? "";
  return (
    <nav aria-label="Sections" className="hidden self-stretch lg:flex">
      <ul className="flex items-stretch gap-6">
        {mobileNavByRole[role].map((item) => {
          const active = itemIsActive(pathname, item.href);
          return (
            <li key={item.href} className="flex">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "focus-ring flex items-center whitespace-nowrap rounded-sm text-body font-medium transition-colors",
                  active
                    ? "text-text shadow-[inset_0_-2px_0_0_var(--accent)]"
                    : "text-text-muted hover:text-text",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

