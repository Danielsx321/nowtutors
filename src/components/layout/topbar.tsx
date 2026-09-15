"use client";

import Link from "next/link";
import { Menu } from "lucide-react";
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
  /** The viewer's inbox. When set, the Messages icon and unread badge render. */
  messagesHref?: string;
  /**
   * Tutors only: the go-live switch rides in the topbar so it is reachable from
   * every tutor page, not only `/tutor` (SPEC §7.5).
   */
  goLive?: { initialLive: boolean; broadcastHref: string | null };
  /** Account-menu links for this role. Only routes that exist are passed in. */
  accountLinks?: { label: string; href: string }[];
}

/**
 * The bar above the content panel: light, one hairline, the page title in the
 * display face, and the controls a signed-in person reaches for. The old ink
 * topbar went with the ink shell in the design overhaul.
 */
export function Topbar({
  title,
  onOpenMenu,
  showCredits,
  credits = 0,
  userName = "Guest",
  messagesHref,
  goLive,
  accountLinks = [],
}: TopbarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur md:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Open menu"
          onClick={onOpenMenu}
        >
          <Menu />
        </Button>
        {title && (
          <h1 className="truncate font-display text-h3 font-semibold text-text">{title}</h1>
        )}
      </div>

      <div className="flex items-center gap-2">
        {goLive && (
          <GoLiveToggle
            variant="compact"
            initialLive={goLive.initialLive}
            broadcastHref={goLive.broadcastHref}
          />
        )}
        {showCredits && <CreditBalance credits={credits} />}
        {messagesHref && <UnreadMessagesLink href={messagesHref} />}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="focus-ring rounded-full" aria-label="Account menu">
              <Avatar name={userName} size="md" />
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
            {/* Log out was a dead menu item until the design overhaul: the only
                way out of the app was the pending-approval or suspended page.
                It runs the same server action those use. */}
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
