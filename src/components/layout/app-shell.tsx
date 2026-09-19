"use client";

import * as React from "react";
import { Sidebar, SidebarAccount, SidebarNav, type SidebarPeople } from "@/components/layout/sidebar";
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
  type Role,
} from "@/components/layout/nav-config";
import { UnreadCountProvider } from "@/components/features/messaging/unread-context";
import { usePresence } from "@/hooks/use-presence";
import { GoLiveProvider } from "@/components/features/tutor/go-live-context";

export interface AppShellProps {
  role: Role;
  title?: string;
  children: React.ReactNode;
  showCredits?: boolean;
  credits?: number;
  userName?: string;
  avatarUrl?: string | null;
  /** Tutors only: state for the topbar's go-live switch (SPEC §7.5). */
  goLive?: { initialLive: boolean; broadcastHref: string | null };
  /** The sidebar's people section, read by the role's layout (student: your tutors). */
  people?: SidebarPeople | null;
}

/** The topbar search per role (Part E: students only; Parts F and G add theirs). */
const searchByRole: Record<Role, { action: string; placeholder: string } | null> = {
  student: { action: "/tutors", placeholder: "Search tutors or subjects…" },
  tutor: null,
  admin: null,
};

/**
 * The authenticated shell (v2, live-globe rebuild Part E; pages.html
 * dashboards): the ground canvas, a white sidebar at `md+` (an icon rail
 * between `md` and `lg`, the full 250px sidebar at `lg`), a bottom bar below
 * `md`, and the topbar above the content. The optional right column and the
 * full-width table row are page layout, not shell, so each dashboard composes
 * them with `DashboardColumns`.
 *
 * It is still where the presence heartbeat is mounted (SPEC §7.5): the one
 * client component every authenticated area shares, so `usePresence()` runs
 * exactly once per area and never on a public page.
 *
 * The drawer serves two triggers: the topbar's menu button and the bottom
 * bar's More. It holds the full nav and the account section, so the four
 * bottom-bar destinations never have to be the whole story.
 */
export function AppShell({
  role,
  title,
  children,
  showCredits,
  credits,
  userName,
  avatarUrl,
  goLive,
  people,
}: AppShellProps) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const items = navByRole[role];
  const messagesHref = messagesHrefByRole[role];
  const accountLinks = accountLinksByRole[role];

  usePresence();

  const shell = (
      <div className="flex min-h-screen bg-ground">
        <Sidebar items={items} messagesHref={messagesHref} people={people} accountLinks={accountLinks} />

        <Drawer open={menuOpen} onOpenChange={setMenuOpen}>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle asChild>
                <span>
                  <Wordmark size="sm" />
                </span>
              </DrawerTitle>
            </DrawerHeader>
            <DrawerBody className="flex flex-col gap-6">
              <SidebarNav items={items} messagesHref={messagesHref} onNavigate={() => setMenuOpen(false)} />
              <SidebarAccount links={accountLinks} onNavigate={() => setMenuOpen(false)} />
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
            avatarUrl={avatarUrl}
            messagesHref={messagesHref}
            goLive={goLive}
            accountLinks={accountLinks}
            search={searchByRole[role]}
          />
          {/* pb-20 clears the bottom bar so it never covers a composer or a
              sticky Save; the bar is only there below `md`. */}
          <main className="flex-1 px-4 pb-24 pt-1 md:px-[clamp(16px,2.4vw,30px)] md:pb-10">
            <div className="w-full">{children}</div>
          </main>
        </div>

        <BottomNav
          role={role}
          messagesHref={messagesHref}
          onOpenMore={() => setMenuOpen(true)}
        />
      </div>
  );

  // Tutors get one shared go-live state for the topbar switch and the
  // dashboard banner (Part F); nobody else has one.
  return (
    <UnreadCountProvider enabled={!!messagesHref}>
      {goLive ? (
        <GoLiveProvider initialLive={goLive.initialLive} broadcastHref={goLive.broadcastHref}>
          {shell}
        </GoLiveProvider>
      ) : (
        shell
      )}
    </UnreadCountProvider>
  );
}
