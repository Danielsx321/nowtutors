"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { useFilterParams } from "@/components/features/tutor-filters";
import { PRICE_BANDS, PRICE_BAND_KEYS } from "@/lib/tutors/filters";
import { LANGUAGES } from "@/lib/geo/languages";
import type { SubjectCount } from "@/db/queries/tutors";

/** Languages shown before "More"; the rest open on request. */
const LANGS_SHOWN = 5;

/**
 * The browse sidebar (DESIGN.md v3 "Public pages"; round 3 Part C, after
 * Oranum's category rail): Live now, every subject with its tutor count, the
 * price bands and the languages. It writes the same query keys the chip row
 * writes, through the same hook, so links stay shareable and `cursor` resets
 * on every change. Shown from `lg`; below that the chip row is the filter.
 */
export function BrowseSidebar({
  subjects,
  className,
}: {
  /** Subjects with counts, most-taught first (`getSubjectTutorCounts`). */
  subjects: SubjectCount[];
  className?: string;
}) {
  const f = useFilterParams();
  const [moreLangs, setMoreLangs] = React.useState(false);
  const liveId = React.useId();

  const langs = moreLangs ? LANGUAGES : LANGUAGES.slice(0, LANGS_SHOWN);
  const hiddenSelected = LANGUAGES.slice(LANGS_SHOWN).some((l) => f.selectedLangs.includes(l));
  const shownLangs = hiddenSelected ? LANGUAGES : langs;

  const item = (on: boolean) =>
    cn(
      "focus-ring flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-small transition-colors",
      on ? "bg-surface-raised font-semibold text-accent" : "text-text hover:bg-surface-raised",
    );

  return (
    <nav aria-label="Filters" className={cn("text-small", className)}>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-raised px-3 py-2.5">
        <label htmlFor={liveId} className="font-semibold text-text">
          Live now
        </label>
        <Switch
          id={liveId}
          checked={f.liveNow}
          onCheckedChange={(on) => f.setSingle("live", on ? "1" : null)}
          className="data-[state=checked]:bg-live"
        />
      </div>

      <Group title="Subjects">
        <li>
          <button
            type="button"
            aria-current={f.selectedSubjects.length === 0 ? "true" : undefined}
            onClick={() => f.clear("subject")}
            className={item(f.selectedSubjects.length === 0)}
          >
            All subjects
          </button>
        </li>
        {subjects.map((s) => {
          const on = f.selectedSubjects.includes(s.slug);
          return (
            <li key={s.slug}>
              <button
                type="button"
                aria-current={on ? "true" : undefined}
                onClick={() => f.toggleMulti("subject", s.slug)}
                className={item(on)}
              >
                <span className="truncate">{s.name}</span>
                <span data-numeric className="shrink-0 text-caption text-text-muted">
                  {s.tutors}
                </span>
              </button>
            </li>
          );
        })}
      </Group>

      <Group title="Price per hour">
        {PRICE_BAND_KEYS.map((key) => {
          const on = f.priceBand === key;
          return (
            <li key={key}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => f.setSingle("price", on ? null : key)}
                className={item(on)}
              >
                {PRICE_BANDS[key].label}
              </button>
            </li>
          );
        })}
      </Group>

      <Group title="Language">
        {shownLangs.map((lang) => {
          const on = f.selectedLangs.includes(lang);
          const id = `lang-${lang}`;
          return (
            <li key={lang} className="flex items-center gap-2.5 px-2.5 py-1.5">
              <Checkbox
                id={id}
                checked={on}
                onCheckedChange={() => f.toggleMulti("lang", lang)}
              />
              <label htmlFor={id} className={cn("cursor-pointer", on ? "font-semibold text-text" : "text-text")}>
                {lang}
              </label>
            </li>
          );
        })}
        {!moreLangs && !hiddenSelected && LANGUAGES.length > LANGS_SHOWN && (
          <li>
            <button
              type="button"
              onClick={() => setMoreLangs(true)}
              className="focus-ring rounded-lg px-2.5 py-1.5 text-small font-medium text-accent hover:underline"
            >
              More languages
            </button>
          </li>
        )}
      </Group>
    </nav>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="mt-5">
      <h2 className="mb-2 px-2.5 font-sans text-caption font-semibold uppercase tracking-[0.08em] text-text-muted">
        {title}
      </h2>
      <ul className="grid gap-0.5">{children}</ul>
    </section>
  );
}
