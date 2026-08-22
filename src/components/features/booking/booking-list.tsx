"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarDays, ChevronRight } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { bookingStatusMeta } from "@/lib/bookings/status";
import type { BookingListItem, BookingTab } from "@/db/queries/bookings";

interface BookingListProps {
  groups: Record<BookingTab, BookingListItem[]>;
  basePath: string; // e.g. "/dashboard/bookings" or "/tutor/bookings"
  counterpartLabel: string; // "Tutor" | "Student"
  viewerTimeZone: string;
  emptyBrowseHref?: string; // students get a "Browse tutors" CTA
}

const TABS: { value: BookingTab; label: string }[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
  { value: "cancelled", label: "Cancelled" },
];

/** Both sides' booking list, tabbed Upcoming | Past | Cancelled (SPEC §6). */
export function BookingList({
  groups,
  basePath,
  counterpartLabel,
  viewerTimeZone,
  emptyBrowseHref,
}: BookingListProps) {
  const fmt = React.useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: viewerTimeZone,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    [viewerTimeZone],
  );

  return (
    <Tabs defaultValue="upcoming">
      <TabsList>
        {TABS.map((t) => (
          <TabsTrigger key={t.value} value={t.value}>
            {t.label}
            {groups[t.value].length > 0 && (
              <span className="ml-1.5 text-caption text-gray-500">
                {groups[t.value].length}
              </span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>

      {TABS.map((t) => (
        <TabsContent key={t.value} value={t.value} className="mt-4 space-y-2">
          {groups[t.value].length === 0 ? (
            <EmptyState
              icon={<CalendarDays className="size-6" />}
              title={`No ${t.label.toLowerCase()} sessions`}
              description={
                t.value === "upcoming"
                  ? "When you book a session it will show up here."
                  : undefined
              }
              action={
                t.value === "upcoming" && emptyBrowseHref ? (
                  <Button asChild>
                    <Link href={emptyBrowseHref}>Browse tutors</Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            groups[t.value].map((b) => {
              const meta = bookingStatusMeta(b.status);
              return (
                <Link
                  key={b.id}
                  href={`${basePath}/${b.id}`}
                  className="focus-ring flex items-center gap-3 rounded-lg border border-gray-200 p-3 transition-colors hover:border-gray-300 hover:bg-gray-50"
                >
                  <Avatar
                    src={b.otherPartyAvatarUrl}
                    name={b.otherPartyName ?? counterpartLabel}
                    size="md"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-body font-medium text-gray-700">
                        {b.otherPartyName ?? counterpartLabel}
                      </p>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    </div>
                    <p className="text-small text-gray-500">
                      {b.scheduledStartAt ? fmt.format(b.scheduledStartAt) : "—"}
                      {b.subjectName ? ` · ${b.subjectName}` : ""}
                      {b.durationMinutes ? ` · ${b.durationMinutes} min` : ""}
                    </p>
                  </div>
                  {b.priceCredits != null && (
                    <span className="whitespace-nowrap text-small font-medium text-gray-500">
                      {b.priceCredits} cr
                    </span>
                  )}
                  <ChevronRight className="size-4 shrink-0 text-gray-400" aria-hidden />
                </Link>
              );
            })
          )}
        </TabsContent>
      ))}
    </Tabs>
  );
}
