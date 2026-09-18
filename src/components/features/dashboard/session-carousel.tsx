"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { TutorPhoto } from "@/components/features/tutor-photo";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export interface SessionCardData {
  id: string;
  href: string;
  personName: string;
  personAvatarUrl: string | null;
  subject: string | null;
  /** The notes, or the subject, or "Session with …". */
  title: string;
  /** "In 2 hrs" */
  whenShort: string;
  /** "Today, 6:00 PM · 45 min" */
  whenLong: string;
  /** 0..1, how close the start is. */
  progress: number;
  /** "Starts in 2 hours", for the bar's accessible name. */
  progressLabel: string;
}

/**
 * "Upcoming sessions" (pages.html, dashboards `.carousel`): photo cards in a
 * horizontally scrolling panel, each with the when-pill on the photo, the
 * subject tag, a title, a countdown bar and the other person. Every card opens
 * the booking page, which owns the join window (the same access decision the
 * classroom enforces), so nothing here decides whether you can join.
 *
 * The arrows scroll the panel; they disable at either end and are hidden when
 * everything fits. The panel itself scrolls by touch or trackpad as well.
 */
export function SessionCarousel({
  title,
  sessions,
  empty,
}: {
  title: string;
  sessions: SessionCardData[];
  empty: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [edge, setEdge] = React.useState({ start: true, end: true });

  const update = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdge({
      start: el.scrollLeft <= 2,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2,
    });
  }, []);

  React.useEffect(() => {
    update();
    const el = ref.current;
    if (!el || typeof ResizeObserver !== "function") return;
    // Watch the cards as well as the panel: the panel's own box doesn't change
    // when its content lays out after styles and fonts load, so watching it
    // alone left the arrows hidden on a first measure taken too early.
    const ro = new ResizeObserver(update);
    ro.observe(el);
    Array.from(el.children).forEach((child) => ro.observe(child));
    return () => ro.disconnect();
  }, [update, sessions.length]);

  const scroll = (dir: 1 | -1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  const fits = edge.start && edge.end;

  return (
    <section aria-labelledby="sessions-title" className="grid min-w-0 gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="sessions-title" className="font-display text-[22px] font-semibold tracking-[-0.02em] text-text">
          {title}
        </h2>
        {sessions.length > 0 && !fits && (
          <div className="flex gap-2">
            <ArrowButton label="Previous sessions" disabled={edge.start} onClick={() => scroll(-1)}>
              <ChevronLeft />
            </ArrowButton>
            <ArrowButton label="Next sessions" disabled={edge.end} onClick={() => scroll(1)} primary>
              <ChevronRight />
            </ArrowButton>
          </div>
        )}
      </div>

      {sessions.length === 0 ? (
        empty
      ) : (
        <div
          ref={ref}
          onScroll={update}
          className="grid snap-x snap-mandatory scroll-px-3.5 auto-cols-[minmax(250px,1fr)] grid-flow-col gap-3.5 overflow-x-auto rounded-[24px] border border-border bg-surface-raised p-3.5"
        >
          {sessions.map((s) => (
            <article key={s.id} className="relative flex snap-start flex-col gap-2.5">
              <div className="relative">
                <TutorPhoto
                  src={s.personAvatarUrl}
                  name={s.personName}
                  sizes="300px"
                  className="aspect-[16/10] w-full rounded-2xl"
                  initialsClassName="text-display"
                />
                <span className="absolute right-2.5 top-2.5 rounded-full bg-surface-raised px-2.5 py-1 text-caption font-semibold text-text">
                  {s.whenShort}
                </span>
              </div>
              {s.subject && (
                <span className="self-start rounded-full border border-border px-2.5 py-0.5 text-caption font-medium text-text">
                  {s.subject}
                </span>
              )}
              <h3 className="line-clamp-2 text-body font-medium leading-snug text-text">
                <Link
                  href={s.href}
                  className="focus-ring rounded-sm after:absolute after:inset-0 after:rounded-2xl"
                >
                  {s.title}
                </Link>
              </h3>
              <div
                role="progressbar"
                aria-label={s.progressLabel}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(s.progress * 100)}
                className="h-1 overflow-hidden rounded-full bg-surface-muted"
              >
                <i className="block h-full rounded-full bg-primary" style={{ width: `${Math.round(s.progress * 100)}%` }} />
              </div>
              <div className="flex items-center gap-2.5 text-small">
                <Avatar src={s.personAvatarUrl ?? undefined} name={s.personName} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate text-text">{s.personName}</span>
                  <span className="block truncate text-caption text-text-muted">{s.whenLong}</span>
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ArrowButton({
  label,
  disabled,
  onClick,
  primary,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "focus-ring grid size-[38px] place-items-center rounded-full border transition-colors disabled:opacity-40 [&_svg]:size-4",
        primary
          ? "border-primary bg-primary text-on-primary hover:bg-primary/85"
          : "border-border bg-surface-raised text-text hover:bg-surface-muted",
      )}
    >
      {children}
    </button>
  );
}
