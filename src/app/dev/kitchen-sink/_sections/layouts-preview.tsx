"use client";

import { CalendarDays, Wallet } from "lucide-react";
import { Section, Demo, type Surface } from "./kit";
import { PublicHeader } from "@/components/layout/public-header";
import { PublicFooter } from "@/components/layout/public-footer";
import { SidebarNav } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { StatCard } from "@/components/ui/stat-card";
import { Wordmark } from "@/components/layout/wordmark";
import { studentNav } from "@/components/layout/nav-config";

/**
 * Framed previews of the two layouts. The real header, footer, sidebar nav and
 * topbar are reused as-is; Part 2 of the design overhaul rebuilds them, so
 * until then they render through the compatibility aliases.
 */
export function LayoutsPreviewSection({ surface }: { surface: Surface }) {
  return (
    <Section id="layouts" title="Layouts" surface={surface}>
      <Demo label="Public shell (header + footer): rebuilt in Part 2" surface={surface} className="items-stretch">
        <div className="w-full overflow-hidden rounded-lg border border-border">
          <PublicHeader />
          <div className="bg-surface px-6 py-12 text-center">
            <p className="font-display text-h2 font-semibold text-text">Learn anything, live.</p>
            <p className="mt-2 text-body text-text-muted">Public page content sits here.</p>
          </div>
          <PublicFooter />
        </div>
      </Demo>

      <Demo label="Authenticated shell: rebuilt in Part 2" surface={surface} className="items-stretch">
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
