"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { PRICE_BANDS, PRICE_BAND_KEYS } from "@/lib/tutors/filters";
import { LANGUAGES } from "@/lib/geo/languages";

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "most_sessions", label: "Most sessions" },
];

export interface Subject {
  slug: string;
  name: string;
}

/** The URL-backed filter state and its setters. Filters live in the query string so links are shareable (SPEC §7.2). */
function useFilterParams(onNavigate?: () => void) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const push = React.useCallback(
    (params: URLSearchParams) => {
      params.delete("cursor"); // any filter change resets pagination
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      onNavigate?.();
    },
    [router, pathname, onNavigate],
  );

  const toggleMulti = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams);
    const all = params.getAll(key);
    params.delete(key);
    const next = all.includes(value) ? all.filter((v) => v !== value) : [...all, value];
    next.forEach((v) => params.append(key, v));
    push(params);
  };

  const setSingle = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (value == null || params.get(key) === value) params.delete(key);
    else params.set(key, value);
    push(params);
  };

  const selectedSubjects = searchParams.getAll("subject");
  const selectedLangs = searchParams.getAll("lang");
  const priceBand = searchParams.get("price");
  const liveNow = searchParams.get("live") === "1";
  const sort = searchParams.get("sort") ?? "relevance";
  const hasFilters =
    selectedSubjects.length > 0 || selectedLangs.length > 0 || !!priceBand || liveNow || sort !== "relevance";

  return { push, toggleMulti, setSingle, selectedSubjects, selectedLangs, priceBand, liveNow, sort, hasFilters };
}

function SortSelect({ id, sort, onChange, className }: { id: string; sort: string; onChange: (v: string) => void; className?: string }) {
  return (
    <Select value={sort} onValueChange={onChange}>
      <SelectTrigger id={id} aria-label="Sort tutors" className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SORT_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The filter groups: price, subjects, language. On `md` and up they sit in the
 * left rail; on phones they open in a sheet from the bar, where `withSort` adds
 * the sort select (the bar has no room for it there).
 */
export function TutorFilters({
  subjects,
  onNavigate,
  withSort = false,
}: {
  subjects: Subject[];
  onNavigate?: () => void;
  withSort?: boolean;
}) {
  const f = useFilterParams(onNavigate);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-h3 font-semibold text-text">Filters</h2>
        {f.hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => f.push(new URLSearchParams())}>
            Clear all
          </Button>
        )}
      </div>

      {withSort && (
        <div className="space-y-1.5">
          <Label htmlFor="sort-sheet">Sort</Label>
          <SortSelect id="sort-sheet" sort={f.sort} onChange={(v) => f.setSingle("sort", v)} />
        </div>
      )}

      <fieldset className="space-y-2">
        <legend className="text-small font-medium text-text">Price per hour</legend>
        {PRICE_BAND_KEYS.map((key) => (
          <label key={key} className="flex cursor-pointer items-center gap-2 text-body text-text">
            <Checkbox
              checked={f.priceBand === key}
              onCheckedChange={() => f.setSingle("price", f.priceBand === key ? null : key)}
            />
            {PRICE_BANDS[key].label}
          </label>
        ))}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-small font-medium text-text">Subjects</legend>
        <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
          {subjects.map((s) => (
            <label key={s.slug} className="flex cursor-pointer items-center gap-2 text-body text-text">
              <Checkbox
                checked={f.selectedSubjects.includes(s.slug)}
                onCheckedChange={() => f.toggleMulti("subject", s.slug)}
              />
              <span className="line-clamp-1">{s.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-small font-medium text-text">Language</legend>
        {LANGUAGES.map((lang) => (
          <label key={lang} className="flex cursor-pointer items-center gap-2 text-body text-text">
            <Checkbox
              checked={f.selectedLangs.includes(lang)}
              onCheckedChange={() => f.toggleMulti("lang", lang)}
            />
            {lang}
          </label>
        ))}
      </fieldset>
    </div>
  );
}

/**
 * The bar above the results, at every width (research report 01, finding 8):
 * the "Live now" chip first, because it is the product's signature filter, then
 * the result count across all pages, then sort on `md` and up or a Filters
 * sheet on phones.
 */
export function TutorFiltersBar({
  subjects,
  resultCount,
}: {
  subjects: Subject[];
  resultCount: number;
}) {
  const [open, setOpen] = React.useState(false);
  const f = useFilterParams();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        aria-pressed={f.liveNow}
        onClick={() => f.setSingle("live", f.liveNow ? null : "1")}
        className={cn(
          "focus-ring inline-flex h-9 items-center gap-2 rounded-full border px-4 text-small font-semibold transition-colors",
          f.liveNow
            ? "border-live bg-live-surface text-live"
            : "border-border-strong bg-surface-raised text-text hover:bg-surface-muted",
        )}
      >
        <span
          aria-hidden
          className={cn("size-2 rounded-full", f.liveNow ? "animate-pulse-live bg-live" : "bg-live")}
        />
        Live now
      </button>

      <p data-numeric className="text-small text-text-muted" aria-live="polite">
        {resultCount.toLocaleString()} {resultCount === 1 ? "tutor" : "tutors"}
      </p>

      <div className="ml-auto flex items-center gap-2">
        <SortSelect
          id="sort"
          sort={f.sort}
          onChange={(v) => f.setSingle("sort", v)}
          className="hidden h-9 w-52 md:flex"
        />
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerTrigger asChild>
            <Button variant="secondary" size="sm" className="md:hidden">
              <SlidersHorizontal aria-hidden />
              Filters
            </Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Filters</DrawerTitle>
            </DrawerHeader>
            <DrawerBody>
              <TutorFilters subjects={subjects} withSort onNavigate={() => setOpen(false)} />
            </DrawerBody>
          </DrawerContent>
        </Drawer>
      </div>
    </div>
  );
}
