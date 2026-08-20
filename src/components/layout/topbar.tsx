"use client";

import { Bell, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { CreditBalance } from "@/components/ui/credit-balance";
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
  /** Opens the mobile nav drawer. */
  onOpenMenu?: () => void;
  /** Presentational sample values — real data wires in later phases. */
  showCredits?: boolean;
  credits?: number;
  userName?: string;
}

// The topbar is part of the INK shell (sidebar + topbar), not a light surface —
// superseding the earlier "white topbar" ruling (DECISIONS.md). Its controls take
// on-ink treatment: white ghost buttons with an ink-800 hover, a gold focus ring,
// and CreditBalance in its `ink` tone. Content areas below stay a white panel.
const onInkGhost =
  "focus-ring-on-ink text-white hover:bg-ink-800 hover:text-white";

export function Topbar({
  title,
  onOpenMenu,
  showCredits,
  credits = 0,
  userName = "Guest",
}: TopbarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-ink-700 bg-ink-900 px-4 md:px-6">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className={cn("md:hidden", onInkGhost)}
          aria-label="Open menu"
          onClick={onOpenMenu}
        >
          <Menu />
        </Button>
        {title && <h1 className="text-h3 font-bold text-white">{title}</h1>}
      </div>

      <div className="flex items-center gap-2">
        {showCredits && <CreditBalance credits={credits} tone="ink" />}
        <Button
          variant="ghost"
          size="icon"
          className={onInkGhost}
          aria-label="Notifications"
        >
          <Bell />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="focus-ring-on-ink rounded-full"
              aria-label="Account menu"
            >
              <Avatar name={userName} size="md" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{userName}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Profile</DropdownMenuItem>
            <DropdownMenuItem>Settings</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive>Log out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
