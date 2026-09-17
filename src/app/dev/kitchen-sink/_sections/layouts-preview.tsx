"use client";

import { CalendarDays, Wallet } from "lucide-react";
import { Section, Demo, type Surface } from "./kit";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { SidebarNav } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { StatCard } from "@/components/ui/stat-card";
import { Wordmark } from "@/components/layout/wordmark";
import { studentNav } from "@/components/layout/nav-config";

/**
 * Framed previews of the two shells. The real header, footer, sidebar nav and
 * topbar are reused as-is. The site footer normally reads the live count on the
 * server; here it is passed a fixed number so the preview has something to
 * show.
 */
export function LayoutsPreviewSection({ surface }: { surface: Surface }) {
  return (
    <Section id="layouts" title="Layouts" surface={surface}>
      <Demo label="Site shell: header and full footer, on every public-facing page" surface={surface} className="items-stretch">
        <div className="w-full overflow-hidden rounded-lg border border-border">
          <SiteHeader viewer={null} />
          <div className="bg-ground px-6 py-12 text-center">
            <p className="font-display text-h2 font-semibold text-text">Learn anything, live.</p>
            <p className="mt-2 text-body text-text-muted">Public page content sits here.</p>
          </div>
          <SiteFooter liveCount={3} />
        </div>
      </Demo>

      <Demo label="Authenticated shell (signed-in pages keep their own chrome)" surface={surface} className="items-stretch">
        <div className="flex w-full overflow-hidden rounded-lg border border-border">
          <div className="hidden w-56 shrink-0 flex-col gap-4 bg-surface-inverse p-4 sm:flex">
            <span className="px-2">
              <Wordmark tone="onDark" size="sm" />
            </span>
            <SidebarNav items={studentNav} />
          </div>
          <div className="min-w-0 flex-1 bg-surface">
            <Topbar
              title="Dashboard"
              showCredits
              credits={1240}
              userName="Ada Lovelace"
            />
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <StatCard
                label="Upcoming sessions"
                value="4"
                icon={<CalendarDays className="size-5" />}
                hint="this week"
              />
              <StatCard
                label="Wallet balance"
                value="1,240"
                icon={<Wallet className="size-5" />}
                hint="credits"
              />
            </div>
          </div>
        </div>
      </Demo>
    </Section>
  );
}
