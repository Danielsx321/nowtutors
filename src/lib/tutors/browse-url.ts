/**
 * URL helpers for the Home / Browse split (live-globe rebuild Part C).
 *
 * Until Part C, `/` was the browse page and every shared browse link looked
 * like `/?subject=algebra`. `/` is now the home landing and browse lives at
 * `/tutors`, so those old links are forwarded rather than silently showing the
 * home page. Pure functions, no Next.js imports, so the rule is unit-tested.
 */

type RawSearchParams = Record<string, string | string[] | undefined>;

/** Query keys that change the browse result set. `_t` cache-busters and the like don't count. */
export const RESULT_KEYS = ["subject", "lang", "price", "live", "sort", "minRating", "cursor", "q"] as const;

/** A Next.js `searchParams` object as `URLSearchParams`, keeping repeated keys. */
export function toSearchParams(sp: RawSearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (Array.isArray(v)) v.forEach((x) => params.append(k, x));
    else if (v != null) params.append(k, v);
  }
  return params;
}

/**
 * Should a request to `/` be forwarded to browse? True when any result-changing
 * key is present, even empty (`/?subject=` was still a browse link). Returns the
 * target with the whole query intact, or null to render the home page.
 */
export function shouldRedirectToBrowse(params: URLSearchParams): string | null {
  const isBrowseLink = RESULT_KEYS.some((k) => params.has(k));
  if (!isBrowseLink) return null;
  return `/tutors?${params.toString()}`;
}

/** The browse URL for a query, with `?` only when there is one. */
export function browseHref(params: URLSearchParams): string {
  const qs = params.toString();
  return qs ? `/tutors?${qs}` : "/tutors";
}

export interface Subject {
  slug: string;
  name: string;
}

/** The best subject for what someone typed: an exact name, then a name that starts with it, then one that contains it. */
export function matchSubject(text: string, subjects: Subject[]): Subject | null {
  const q = text.trim().toLowerCase();
  if (!q) return null;
  return (
    subjects.find((s) => s.name.toLowerCase() === q || s.slug === q) ??
    subjects.find((s) => s.name.toLowerCase().startsWith(q)) ??
    subjects.find((s) => s.name.toLowerCase().includes(q)) ??
    null
  );
}
