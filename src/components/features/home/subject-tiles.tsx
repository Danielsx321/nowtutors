import Link from "next/link";
import type { SubjectCount } from "@/db/queries/tutors";

/**
 * Subject entry points under the grid, with real tutor counts (research
 * report 01, finding 5). Only subjects someone actually teaches, so a tile
 * never leads to an empty page. A count shows from {@link COUNT_FROM} tutors
 * up: "1 tutor" on every tile makes a young marketplace look empty.
 */
const COUNT_FROM = 3;

export function SubjectTiles({ subjects }: { subjects: SubjectCount[] }) {
  if (subjects.length === 0) return null;
  return (
    <section aria-labelledby="subjects-title" className="space-y-4">
      <h2 id="subjects-title" className="text-h2 font-semibold text-text">
        Browse by subject
      </h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {subjects.slice(0, 12).map((s) => (
          <li key={s.slug}>
            <Link
              href={`/?subject=${encodeURIComponent(s.slug)}#tutors`}
              className="focus-ring flex h-full flex-col justify-between gap-2 rounded-xl border border-border bg-surface-raised p-4 transition-colors hover:border-border-strong"
            >
              <span className="font-display text-body-lg font-semibold text-text">{s.name}</span>
              {s.tutors >= COUNT_FROM && (
                <span data-numeric className="text-small text-text-muted">
                  {s.tutors.toLocaleString()} tutors
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
