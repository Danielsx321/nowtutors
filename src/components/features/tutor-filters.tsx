"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
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

export function TutorFilters({
  subjects,
  onNavigate,
}: {
  subjects: Subject[];
  onNavigate?: () => void;
}) {
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
    const next = all.includes(value)
      ? all.filter((v) => v !== value)
      : [...all, value];
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
    selectedSubjects.length > 0 ||
    selectedLangs.length > 0 ||
    !!priceBand ||
    liveNow ||
    sort !== "relevance";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-h3 font-bold text-gray-700">Filters</h2>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => push(new URLSearchParams())}
          >
            Clear all
          </Button>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sort">Sort</Label>
        <Select value={sort} onValueChange={(v) => setSingle("sort", v)}>
          <SelectTrigger id="sort">
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
      </div>

      <label className="flex items-center justify-between gap-3">
        <span className="text-small font-medium text-gray-700">Live now</span>
        <Switch
          checked={liveNow}
          onCheckedChange={(c) => setSingle("live", c ? "1" : null)}
        />
      </label>

      <fieldset className="space-y-2">
        <legend className="text-small font-medium text-gray-700">Price</legend>
        {PRICE_BAND_KEYS.map((key) => (
          <label
            key={key}
            className="flex cursor-pointer items-center gap-2 text-body text-gray-700"
          >
            <Checkbox
              checked={priceBand === key}
              onCheckedChange={() =>
                setSingle("price", priceBand === key ? null : key)
              }
            />
            {PRICE_BANDS[key].label}
          </label>
        ))}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-small font-medium text-gray-700">Subjects</legend>
        <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
          {subjects.map((s) => (
            <label
              key={s.slug}
              className="flex cursor-pointer items-center gap-2 text-body text-gray-700"
            >
              <Checkbox
                checked={selectedSubjects.includes(s.slug)}
                onCheckedChange={() => toggleMulti("subject", s.slug)}
              />
              <span className="line-clamp-1">{s.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-small font-medium text-gray-700">Language</legend>
        {LANGUAGES.map((lang) => (
          <label
            key={lang}
            className="flex cursor-pointer items-center gap-2 text-body text-gray-700"
          >
            <Checkbox
              checked={selectedLangs.includes(lang)}
              onCheckedChange={() => toggleMulti("lang", lang)}
            />
            {lang}
          </label>
        ))}
      </fieldset>
    </div>
  );
}

export function TutorFiltersBar({
  subjects,
  resultCount,
}: {
  subjects: Subject[];
  resultCount: number;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="flex items-center justify-between md:hidden">
      <p className="text-small text-gray-500">{resultCount} tutors</p>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>
          <Button variant="secondary" size="sm">
            Filters
          </Button>
        </DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Filters</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <TutorFilters subjects={subjects} onNavigate={() => setOpen(false)} />
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
