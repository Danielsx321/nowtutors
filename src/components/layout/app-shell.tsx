"use client";

import * as React from "react";
import { Sidebar, SidebarNav } from "@/components/layout/sidebar";
import { BottomNav } from "@/components/layout/bottom-nav";
import { Topbar } from "@/components/layout/topbar";
import { Wordmark } from "@/components/layout/wordmark";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  accountLinksByRole,
  messagesHrefByRole,
  navByRole,
  roleHome,
  type Role,
} from "@/components/layout/nav-config";
import { UnreadCountProvider } from "@/components/features/messaging/unread-context";
import { usePresence } from "@/hooks/use-presence";

export interface AppShellProps {
  role: Role;
  title?: string;
  children: React.ReactNode;
  showCredits?: boolean;
  credits?: number;
  userName?: string;
  /** Tutors only: state for the topbar's go-live switch (SPEC §7.5). */
  goLive?: { initialLive: boolean; broadcastHref: string | null };
}

/**
 * The authenticated shell: a light canvas with a sidebar at `md+` (an icon rail
 * between `md` and `lg`, full width at `lg`), a bottom bar below `md`, and the
 * topbar above the content. This replaces the ink frame (ink shell → white
 * panel → ink cards) the design overhaul retired.
 *
 * It is still where the presence heartbeat is mounted (SPEC §7.5): the one
 * client component every authenticated area shares, so `usePresence()` runs
 * exactly once per area and never on a public page.
 *
 * The drawer serves two triggers: the topbar's menu button and the bottom
 * bar's More. It holds the full nav, so the four bottom-bar destinations never
 * have to be the whole story.
 */
export function AppShell({
  role,
  title,
  children,
  showCredits,
  credits,
  userName,
  goLive,
}: AppShellProps) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const items = navByRole[role];
  const messagesHref = messagesHrefByRole[role];

  usePresence();

  return (
    <UnreadCountProvider enabled={!!messagesHref}>
      <div className="flex min-h-screen bg-surface">
        <Sidebar items={items} roleLabel={roleHome[role]} />

        <Drawer open={menuOpen} onOpenChange={setMenuOpen}>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle asChild>
                <span>
                  <Wordmark size="sm" />
                </span>
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
            messagesHref={messagesHref}
            goLive={goLive}
            accountLinks={accountLinksByRole[role]}
          />
          {/* pb-16 clears the bottom bar so it never covers a composer or a
              sticky Save; the bar is only there below `md`. */}
          <main className="flex-1 p-4 pb-20 md:p-5 md:pb-5">
            <div className="w-full">{children}</div>
          </main>
        </div>

        <BottomNav
          role={role}
          messagesHref={messagesHref}
          onOpenMore={() => setMenuOpen(true)}
        />
      </div>
    </UnreadCountProvider>
  );
}
