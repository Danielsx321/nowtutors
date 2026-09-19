"use client";

import Link from "next/link";
import { CalendarClock, Clock, Coins } from "lucide-react";
import { Section, Demo, type Surface } from "./kit";
import { SidebarAccount, SidebarNav } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { Wordmark } from "@/components/layout/wordmark";
import { studentNav } from "@/components/layout/nav-config";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/features/dashboard/banner";
import { SummaryCard } from "@/components/features/dashboard/summary-card";
import { SessionCarousel } from "@/components/features/dashboard/session-carousel";
import { BarChart } from "@/components/features/dashboard/bar-chart";
import { PeopleList } from "@/components/features/dashboard/people-list";
import { BookingsTable } from "@/components/features/dashboard/bookings-table";
import { DashboardColumns, RailBox } from "@/components/features/dashboard/dashboard-columns";
import { UnreadCountProvider } from "@/components/features/messaging/unread-context";
import { GoLiveProvider } from "@/components/features/tutor/go-live-context";
import { GoLiveBanner } from "@/components/features/tutor/go-live-banner";
import { Check, X } from "lucide-react";

/**
 * The v2 app shell and dashboard pieces (live-globe rebuild Part E), with
 * example data. The real dashboards need a signed-in person, so this is where
 * the layout is checked at every width without one. Names and numbers are
 * illustrations.
 */
export function DashboardSection({ surface }: { surface: Surface }) {
  return (
    <Section id="dashboard" title="Dashboard" surface={surface}>
      <Demo label="Student dashboard in the v2 shell (example data)" surface={surface} className="items-stretch">
        {/* One disabled provider, as the real shell has one live one: without it
            every badge would open its own Realtime channel on the same topic. */}
        <UnreadCountProvider enabled={false}>
        <div className="flex w-full overflow-hidden rounded-lg border border-border bg-ground">
          <div className="hidden w-[250px] shrink-0 flex-col gap-[26px] border-r border-border bg-surface-raised px-[18px] py-[26px] lg:flex">
            <span className="px-2.5">
              <Wordmark size="sm" />
            </span>
            <SidebarNav items={studentNav} messagesHref="/dashboard/messages" />
            <div className="mt-auto">
              <SidebarAccount links={[]} />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <Topbar
              userName="Amara Okafor"
              messagesHref="/dashboard/messages"
              showCredits
              credits={240}
              search={{ action: "/tutors", placeholder: "Search tutors or subjects…" }}
            />
            <div className="px-4 pb-8 md:px-[clamp(16px,2.4vw,30px)]">
              <DashboardColumns
                main={
                  <>
                    <Banner kicker="Live now" title="12 tutors are ready to teach you this minute">
                      <Button asChild variant="highlight">
                        <Link href="/tutors?live=1">Find a live tutor</Link>
                      </Button>
                      <span className="text-small text-on-primary/75">Sofia, Kwame and 10 more</span>
                    </Banner>
                    <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr))]">
                      <SummaryCard icon={CalendarClock} label="Next session" value="Today, 6:00 PM" href="#" />
                      <SummaryCard icon={Coins} label="Credits" value="240 ≈ $320" href="#" />
                      <SummaryCard icon={Clock} label="This month" value="6 sessions · 4.5 hrs" href="#" />
                    </div>
                    <SessionCarousel
                      title="Upcoming sessions"
                      empty={null}
                      sessions={[
                        ["Sofia Marchetti", "Maths", "Quadratic equations before Friday's test", "In 2 hrs", "Today, 6:00 PM · 45 min", 0.8],
                        ["Kwame Mensah", "Coding", "Build a first Python project: a quiz game", "Tomorrow", "Tomorrow, 4:30 PM · 60 min", 0.45],
                        ["Marco Silva", "Economics", "Supply and demand, with past paper questions", "Sat", "Sat, 11:00 AM · 30 min", 0.2],
                      ].map(([name, subject, title, short, long, p], i) => ({
                        id: String(i),
                        href: "#",
                        personName: name as string,
                        personAvatarUrl: null,
                        subject: subject as string,
                        title: title as string,
                        whenShort: short as string,
                        whenLong: long as string,
                        progress: p as number,
                        progressLabel: `Starts ${long}`,
                      }))}
                    />
                  </>
                }
                rail={
                  <>
                    <RailBox title="Your learning">
                      <BarChart
                        title="Hours learned per month"
                        unit="hrs"
                        data={[
                          { label: "May", value: 1.5 },
                          { label: "Jun", value: 3 },
                          { label: "Jul", value: 0 },
                          { label: "Aug", value: 2.5 },
                          { label: "Sep", value: 4.5 },
                        ]}
                      />
                    </RailBox>
                    <RailBox title="Your tutors">
                      <PeopleList
                        people={[
                          { id: "a", name: "Sofia Marchetti", avatarUrl: null, href: "#", detail: "Maths · live now", live: true, action: { label: "Request", href: "#", variant: "primary" } },
                          { id: "b", name: "Marco Silva", avatarUrl: null, href: "#", detail: "Economics · 3 sessions", action: { label: "Book again", href: "#", variant: "outline" } },
                        ]}
                      />
                    </RailBox>
                  </>
                }
                full={
                  <BookingsTable
                    personHeading="Tutor"
                    rows={[
                      { id: "1", href: "#", personName: "Sofia Marchetti", personAvatarUrl: null, detail: "45 credits", subject: "Maths", when: "Today, 6:00 PM", status: "confirmed" },
                      { id: "2", href: "#", personName: "Marco Silva", personAvatarUrl: null, detail: "23 credits", subject: "Economics", when: "Mon 15 Sep, 11:00 AM", status: "completed" },
                    ]}
                  />
                }
              />
            </div>
          </div>
        </div>
        </UnreadCountProvider>
      </Demo>

      <Demo label="Tutor dashboard pieces: go-live banner, profile checklist, earnings stages (example data)" surface={surface} className="items-stretch">
        <GoLiveProvider initialLive={false} broadcastHref={null}>
          <div className="w-full rounded-lg border border-border bg-ground p-4">
            <DashboardColumns
              main={<GoLiveBanner othersLive={11} />}
              rail={
                <RailBox title="Earnings">
                  <div className="grid gap-2.5">
                    <div className="flex items-center gap-3 rounded-2xl border border-border px-3.5 py-3">
                      <div>
                        <p className="text-caption text-text-muted">Held · releases after 48 hrs</p>
                        <p className="font-display text-[18px] font-semibold text-text">92 cr</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 rounded-2xl border border-primary px-3.5 py-3">
                      <div>
                        <p className="text-caption text-text-muted">Available</p>
                        <p className="font-display text-[18px] font-semibold text-text">310 cr ≈ $310.00</p>
                      </div>
                      <Button size="sm" className="ml-auto h-[34px] px-3.5">Withdraw</Button>
                    </div>
                  </div>
                  <ul className="grid gap-2 text-small">
                    <li className="flex items-center gap-2 text-live"><Check className="size-4" aria-hidden />Photo added</li>
                    <li className="flex items-center gap-2 text-spark-text"><X className="size-4" aria-hidden />Set your weekly availability</li>
                  </ul>
                </RailBox>
              }
            />
          </div>
        </GoLiveProvider>
      </Demo>
    </Section>
  );
}
