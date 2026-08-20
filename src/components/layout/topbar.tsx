"use client";

import { Bell, Menu } from "lucide-react";
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

// The topbar is a LIGHT surface (white). Only the sidebar and the mobile nav
// drawer are dark chrome — keeping the ink surface area small means light-surface
// primitives (Breadcrumb, CreditBalance, ghost Buttons) compose here as-is.
export function Topbar({
  title,
  onOpenMenu,
  showCredits,
  credits = 0,
  userName = "Guest",
}: TopbarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 md:px-6">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Open menu"
          onClick={onOpenMenu}
        >
          <Menu />
        </Button>
        {title && <h1 className="text-h3 font-bold text-gray-700">{title}</h1>}
      </div>

      <div className="flex items-center gap-2">
        {showCredits && <CreditBalance credits={credits} />}
        <Button variant="ghost" size="icon" aria-label="Notifications">
          <Bell />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="focus-ring rounded-full" aria-label="Account menu">
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
