"use client";

import Link from "next/link";
import { Menu, Search } from "lucide-react";
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
 * The bar above the content (v2, Part E): on the ground colour with no rule,
 * as mocked. A search pill on the left when the role has one (the page title
 * otherwise), then the go-live switch for tutors, the credit pill for
 * students, the Messages circle with its unread count, and the avatar with the
 * person's name, which opens the account menu.
 */
export function Topbar({
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
    <header className="sticky top-0 z-30 flex items-center gap-3 bg-ground/90 px-4 py-3 backdrop-blur md:px-[clamp(16px,2.4vw,30px)] md:py-[22px]">
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 md:hidden"
        aria-label="Open menu"
        onClick={onOpenMenu}
      >
        <Menu />
      </Button>

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
              aria-label="Account menu"
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
