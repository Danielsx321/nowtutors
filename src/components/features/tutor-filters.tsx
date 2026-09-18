"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PRICE_BANDS, PRICE_BAND_KEYS } from "@/lib/tutors/filters";
import { LANGUAGES } from "@/lib/geo/languages";
import { matchSubject, type Subject } from "@/lib/tutors/browse-url";

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "most_sessions", label: "Most sessions" },
];

export type { Subject };

/** The URL-backed filter state and its setters. Filters live in the query string so links are shareable (SPEC §7.2). */
function useFilterParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const push = React.useCallback(
    (params: URLSearchParams) => {
      params.delete("cursor"); // any filter change resets pagination
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  const next = () => new URLSearchParams(searchParams);

  const toggleMulti = (key: string, value: string) => {
    const params = next();
    const all = params.getAll(key);
    params.delete(key);
    const updated = all.includes(value) ? all.filter((v) => v !== value) : [...all, value];
    updated.forEach((v) => params.append(key, v));
    push(params);
  };

  const setSingle = (key: string, value: string | null) => {
    const params = next();
    if (value == null || params.get(key) === value) params.delete(key);
    else params.set(key, value);
    push(params);
  };

  /** Set a key outright (no toggling off), or remove it with null. */
  const setValue = (key: string, value: string | null) => {
    const params = next();
    if (value == null) params.delete(key);
    else params.set(key, value);
    push(params);
  };

  const clear = (key: string) => {
    const params = next();
    params.delete(key);
    push(params);
  };

  return {
    push,
    next,
    toggleMulti,
    setSingle,
    setValue,
    clear,
    selectedSubjects: searchParams.getAll("subject"),
    selectedLangs: searchParams.getAll("lang"),
    priceBand: searchParams.get("price"),
    liveNow: searchParams.get("live") === "1",
    sort: searchParams.get("sort") ?? "relevance",
  };
}

/**
 * The search pill on browse (pages.html, Browse). Tutors are found by subject,
 * so the pill searches subjects: the browser suggests names from the real list
 * as you type, and Search picks the best match and filters by it (`?subject=`),
 * keeping the other filters. Text that matches no subject says so instead of
 * returning a silently empty grid.
 */
export function SubjectSearch({ subjects }: { subjects: Subject[] }) {
  const f = useFilterParams();
  const selectedName =
    f.selectedSubjects.length === 1
      ? (subjects.find((s) => s.slug === f.selectedSubjects[0])?.name ?? "")
      : "";
  const [text, setText] = React.useState(selectedName);
  const [miss, setMiss] = React.useState<string | null>(null);
  const listId = React.useId();

  React.useEffect(() => setText(selectedName), [selectedName]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const params = f.next();
    params.delete("subject");
    if (!text.trim()) {
      setMiss(null);
      f.push(params);
      return;
    }
    const match = matchSubject(text, subjects);
    if (!match) {
      setMiss(text.trim());
      return;
    }
    setMiss(null);
    setText(match.name);
    params.append("subject", match.slug);
    f.push(params);
  };

  return (
    <form role="search" onSubmit={onSubmit} className="max-w-[720px]">
      <div className="flex items-center gap-2 rounded-full border border-border bg-surface-raised py-1.5 pl-5 pr-1.5 focus-within:border-primary">
        <Search className="size-5 shrink-0 text-text-muted" aria-hidden />
        <label htmlFor="subject-search" className="sr-only">
          Search subjects
        </label>
        <input
          id="subject-search"
          list={listId}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setMiss(null);
          }}
          placeholder="Search a subject, like Maths or IELTS"
          autoComplete="off"
          aria-describedby={miss ? "subject-search-miss" : undefined}
          className="min-w-0 flex-1 bg-transparent text-body-lg font-medium text-text outline-none placeholder:font-normal placeholder:text-text-muted"
        />
        <datalist id={listId}>
          {subjects.map((s) => (
            <option key={s.slug} value={s.name} />
          ))}
        </datalist>
        <Button type="submit" size="sm">
          Search
        </Button>
      </div>
      {miss && (
        <p id="subject-search-miss" role="status" className="mt-2 pl-5 text-small text-text-muted">
          No subject matches &ldquo;{miss}&rdquo;. Try a broader word, or pick a subject below.
        </p>
      )}
    </form>
  );
}

const chip =
  "focus-ring inline-flex h-[38px] shrink-0 items-center gap-[7px] rounded-full border px-3.5 text-small font-medium transition-colors";
const chipOff = "border-border-strong/40 bg-surface-raised text-text hover:bg-surface-muted";
const chipOn = "border-ink bg-ink text-on-ink";

function DropdownChip({
  label,
  active,
  children,
}: {
  label: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(chip, active ? chipOn : chipOff)}>
        {label}
        <ChevronDown className="size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The chip row above the results (pages.html, Browse; research report 01,
 * finding 8): "Live now" first, because it is the product's signature filter;
 * then All subjects and the most-taught subjects as chips; Price and Language
 * as dropdown chips; then the result count across all pages and the sort.
 * Every filter the old side rail had is here, so there is no rail and no
 * phone-only sheet: on a phone the chips scroll sideways.
 */
export function TutorFilterChips({
  subjects,
  chipSubjects,
  resultCount,
}: {
  /** Every active subject, to name a selected one that isn't a chip. */
  subjects: Subject[];
  /** The few subjects shown as chips (the most-taught ones). */
  chipSubjects: Subject[];
  resultCount: number;
}) {
  const f = useFilterParams();

  // A selected subject always shows as an "on" chip, even if it isn't one of the top few.
  const shown = [...chipSubjects];
  for (const slug of f.selectedSubjects) {
    if (!shown.some((s) => s.slug === slug)) {
      const s = subjects.find((x) => x.slug === slug);
      shown.push(s ?? { slug, name: slug });
    }
  }

  const priceLabel = f.priceBand && f.priceBand in PRICE_BANDS
    ? PRICE_BANDS[f.priceBand as keyof typeof PRICE_BANDS].label
    : "Price";
  const langLabel =
    f.selectedLangs.length === 0
      ? "Language"
      : f.selectedLangs.length === 1
        ? f.selectedLangs[0]!
        : `${f.selectedLangs.length} languages`;
  const sortLabel = SORT_OPTIONS.find((o) => o.value === f.sort)?.label ?? "Relevance";

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <div
        role="group"
        aria-label="Filters"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0"
      >
        <button
          type="button"
          aria-pressed={f.liveNow}
          onClick={() => f.setSingle("live", f.liveNow ? null : "1")}
          className={cn(
            chip,
            f.liveNow
              ? "border-live bg-live-surface text-live"
              : "border-live bg-surface-raised text-live hover:bg-live-surface",
          )}
        >
          <span aria-hidden className={cn("size-[7px] rounded-full bg-live", f.liveNow && "animate-pulse-live")} />
          Live now
        </button>

        <button
          type="button"
          aria-pressed={f.selectedSubjects.length === 0}
          onClick={() => f.clear("subject")}
          className={cn(chip, f.selectedSubjects.length === 0 ? chipOn : chipOff)}
        >
          All subjects
        </button>
        {shown.map((s) => {
          const on = f.selectedSubjects.includes(s.slug);
          return (
            <button
              key={s.slug}
              type="button"
              aria-pressed={on}
              onClick={() => f.toggleMulti("subject", s.slug)}
              className={cn(chip, on ? chipOn : chipOff)}
            >
              {s.name}
            </button>
          );
        })}

        <DropdownChip label={priceLabel} active={!!f.priceBand}>
          {PRICE_BAND_KEYS.map((key) => (
            <DropdownMenuCheckboxItem
              key={key}
              checked={f.priceBand === key}
              onCheckedChange={() => f.setSingle("price", f.priceBand === key ? null : key)}
            >
              {PRICE_BANDS[key].label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownChip>

        <DropdownChip label={langLabel} active={f.selectedLangs.length > 0}>
          {LANGUAGES.map((lang) => (
            <DropdownMenuCheckboxItem
              key={lang}
              checked={f.selectedLangs.includes(lang)}
              onCheckedChange={() => f.toggleMulti("lang", lang)}
            >
              {lang}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownChip>
      </div>

      <div className="flex shrink-0 items-center gap-3 whitespace-nowrap lg:ml-auto">
        <p data-numeric className="text-small text-text-muted" aria-live="polite">
          {resultCount.toLocaleString()} {resultCount === 1 ? "tutor" : "tutors"}
        </p>
        <span aria-hidden className="text-text-muted">·</span>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Sort tutors: ${sortLabel}`}
            className="focus-ring inline-flex items-center gap-1 rounded-full text-small text-text-muted hover:text-text"
          >
            Sort: <span className="font-medium text-text">{sortLabel}</span>
            <ChevronDown className="size-4" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {SORT_OPTIONS.map((o) => (
              <DropdownMenuCheckboxItem
                key={o.value}
                checked={f.sort === o.value}
                onCheckedChange={() => f.setValue("sort", o.value === "relevance" ? null : o.value)}
              >
                {o.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
