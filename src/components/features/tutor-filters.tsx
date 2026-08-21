"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
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
  surface = "light",
}: {
  subjects: Subject[];
  onNavigate?: () => void;
  /** "ink" mirrors the Bubble dark sidebar (desktop rail); "light" is the default drawer surface. */
  surface?: "light" | "ink";
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

  const ink = surface === "ink";
  const headingText = ink ? "text-white" : "text-gray-700";
  const labelText = ink ? "text-white" : "text-gray-700";
  const rowText = ink ? "text-white" : "text-gray-700";
  const checkboxInk = ink
    ? "border-ink-300 data-[state=checked]:border-gold-400 data-[state=checked]:bg-gold-400 data-[state=checked]:text-ink-900 data-[state=indeterminate]:border-gold-400 data-[state=indeterminate]:bg-gold-400 data-[state=indeterminate]:text-ink-900"
    : undefined;
  const switchInk = ink ? "data-[state=checked]:bg-gold-400" : undefined;
  const selectTriggerInk = ink
    ? "border-ink-700 bg-ink-800 text-white data-[placeholder]:text-ink-300 hover:border-ink-300 [&_svg]:text-ink-300"
    : undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className={cn("text-h3 font-bold", headingText)}>Filters</h2>
        {hasFilters && (
          <Button
            variant={ink ? "ink-ghost" : "ghost"}
            size="sm"
            onClick={() => push(new URLSearchParams())}
          >
            Clear all
          </Button>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sort" className={ink ? "text-white" : undefined}>
          Sort
        </Label>
        <Select value={sort} onValueChange={(v) => setSingle("sort", v)}>
          <SelectTrigger id="sort" className={selectTriggerInk}>
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
        <span className={cn("text-small font-medium", labelText)}>Live now</span>
        <Switch
          checked={liveNow}
          onCheckedChange={(c) => setSingle("live", c ? "1" : null)}
          className={switchInk}
        />
      </label>

      <fieldset className="space-y-2">
        <legend className={cn("text-small font-medium", labelText)}>Price</legend>
        {PRICE_BAND_KEYS.map((key) => (
          <label
            key={key}
            className={cn("flex cursor-pointer items-center gap-2 text-body", rowText)}
          >
            <Checkbox
              checked={priceBand === key}
              onCheckedChange={() =>
                setSingle("price", priceBand === key ? null : key)
              }
              className={checkboxInk}
            />
            {PRICE_BANDS[key].label}
          </label>
        ))}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className={cn("text-small font-medium", labelText)}>Subjects</legend>
        <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
          {subjects.map((s) => (
            <label
              key={s.slug}
              className={cn("flex cursor-pointer items-center gap-2 text-body", rowText)}
            >
              <Checkbox
                checked={selectedSubjects.includes(s.slug)}
                onCheckedChange={() => toggleMulti("subject", s.slug)}
                className={checkboxInk}
              />
              <span className="line-clamp-1">{s.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className={cn("text-small font-medium", labelText)}>Language</legend>
        {LANGUAGES.map((lang) => (
          <label
            key={lang}
            className={cn("flex cursor-pointer items-center gap-2 text-body", rowText)}
          >
            <Checkbox
              checked={selectedLangs.includes(lang)}
              onCheckedChange={() => toggleMulti("lang", lang)}
              className={checkboxInk}
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
