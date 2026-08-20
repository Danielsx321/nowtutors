"use client";

import { CalendarDays, Wallet } from "lucide-react";
import { Section, Demo, type Surface } from "./kit";
import { PublicHeader } from "@/components/layout/public-header";
import { PublicFooter } from "@/components/layout/public-footer";
import { SidebarNav } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { StatCard } from "@/components/ui/stat-card";
import { studentNav } from "@/components/layout/nav-config";

/**
 * Framed previews of the two layouts so both are visible in the kitchen sink
 * without needing route pages (those arrive in later phases). The real header,
 * footer, sidebar nav, and topbar components are reused as-is.
 */
export function LayoutsPreviewSection({ surface }: { surface: Surface }) {
  return (
    <Section id="layouts" title="Layouts" surface={surface}>
      <Demo label="Public shell (header + footer)" surface={surface} className="items-stretch">
        <div className="w-full overflow-hidden rounded-lg border border-gray-200">
          <PublicHeader />
          <div className="bg-ink-900 px-6 py-12 text-center">
            <p className="text-h2 font-bold text-white">
              Learn anything, <span className="text-gold-400">live</span>.
            </p>
            <p className="mt-2 text-body text-gray-200">Public page content sits here.</p>
          </div>
          <PublicFooter />
        </div>
      </Demo>

      <Demo label="Authenticated shell (ink frame → white panel → ink card)" surface={surface} className="items-stretch">
        <div className="flex w-full overflow-hidden rounded-lg border border-ink-700">
          <div className="hidden w-56 shrink-0 flex-col gap-4 bg-ink-900 p-4 sm:flex">
            <span className="px-2 text-h3 font-bold text-white">
              Now<span className="text-gold-400">Tutors</span>
            </span>
            <SidebarNav items={studentNav} />
          </div>
          <div className="min-w-0 flex-1 bg-white">
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
                surface="ink"
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
