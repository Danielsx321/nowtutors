"use client";

import * as React from "react";
import { Sidebar, SidebarNav } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { navByRole, roleHome, type Role } from "@/components/layout/nav-config";

export interface AppShellProps {
  role: Role;
  title?: string;
  children: React.ReactNode;
  /** Presentational sample chrome — real data wires in later phases. */
  showCredits?: boolean;
  credits?: number;
  userName?: string;
}

/**
 * Authenticated shell: an INK frame (sidebar + topbar) wrapping a white content
 * panel, with a mobile nav drawer. Supersedes the earlier "dark sidebar + white
 * topbar + light content" model (DECISIONS.md). Presentational only — role
 * guards land in Phase 3. Nav comes from the static §6 config keyed by role.
 */
export function AppShell({
  role,
  title,
  children,
  showCredits,
  credits,
  userName,
}: AppShellProps) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const items = navByRole[role];

  return (
    <div className="flex min-h-screen bg-ink-900">
      <Sidebar items={items} roleLabel={roleHome[role]} />

      <Drawer open={menuOpen} onOpenChange={setMenuOpen}>
        <DrawerContent className="bg-ink-900 [&_[aria-label=Close]]:text-gray-200 [&_[aria-label=Close]]:hover:bg-ink-800 [&_[aria-label=Close]]:hover:text-white">
          <DrawerHeader className="border-ink-700">
            <DrawerTitle className="text-white">
              Now<span className="text-gold-400">Tutors</span>
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <SidebarNav items={items} onNavigate={() => setMenuOpen(false)} />
          </DrawerBody>
        </DrawerContent>
      </Drawer>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          title={title}
          onOpenMenu={() => setMenuOpen(true)}
          showCredits={showCredits}
          credits={credits}
          userName={userName}
        />
        {/* White content panel inset into the ink frame (§ Bubble parity). */}
        <main className="flex-1 bg-white p-4 md:rounded-tl-lg md:p-5">
          <div className="container-page px-0">{children}</div>
        </main>
      </div>
    </div>
  );
}
