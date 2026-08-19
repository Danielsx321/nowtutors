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
 * Authenticated shell: dark sidebar + light content, with a mobile nav drawer.
 * Presentational only — role guards land in Phase 3. Nav comes from the static
 * §6 config keyed by role.
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
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar items={items} roleLabel={roleHome[role]} />

      <Drawer open={menuOpen} onOpenChange={setMenuOpen}>
        <DrawerContent className="bg-ink-900 [&_[aria-label=Close]]:text-white [&_[aria-label=Close]]:hover:bg-ink-800">
          <DrawerHeader className="border-ink-800">
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
        <main className="flex-1 p-4 md:p-6">
          <div className="container-page px-0">{children}</div>
        </main>
      </div>
    </div>
  );
}
