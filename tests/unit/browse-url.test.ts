import { describe, expect, it } from "vitest";
import {
  browseHref,
  matchSubject,
  shouldRedirectToBrowse,
  toSearchParams,
} from "@/lib/tutors/browse-url";

const p = (qs: string) => new URLSearchParams(qs);

describe("shouldRedirectToBrowse (Part C: old /?filter links forward to /tutors)", () => {
  it("renders the home page for a bare /", () => {
    expect(shouldRedirectToBrowse(p(""))).toBeNull();
  });

  it("ignores keys that don't change results", () => {
    expect(shouldRedirectToBrowse(p("_t=123"))).toBeNull();
    expect(shouldRedirectToBrowse(p("utm_source=x&ref=y"))).toBeNull();
  });

  it.each(["subject", "lang", "price", "live", "sort", "minRating", "cursor"])(
    "forwards when %s is present",
    (key) => {
      expect(shouldRedirectToBrowse(p(`${key}=x`))).toBe(`/tutors?${key}=x`);
    },
  );

  it("forwards an empty result key too (it was still a browse link)", () => {
    expect(shouldRedirectToBrowse(p("subject="))).toBe("/tutors?subject=");
  });

  it("keeps the whole query, repeated keys and extras included", () => {
    expect(shouldRedirectToBrowse(p("subject=algebra&subject=physics&live=1&_t=9"))).toBe(
      "/tutors?subject=algebra&subject=physics&live=1&_t=9",
    );
  });
});

describe("toSearchParams / browseHref", () => {
  it("keeps repeated keys from a Next.js searchParams object", () => {
    const params = toSearchParams({ subject: ["a", "b"], live: "1", empty: undefined });
    expect(params.getAll("subject")).toEqual(["a", "b"]);
    expect(params.get("live")).toBe("1");
    expect(params.has("empty")).toBe(false);
  });

  it("builds /tutors with or without a query", () => {
    expect(browseHref(p(""))).toBe("/tutors");
    expect(browseHref(p("live=1"))).toBe("/tutors?live=1");
  });
});

describe("matchSubject (the browse search pill)", () => {
  const subjects = [
    { slug: "maths", name: "Maths" },
    { slug: "further-maths", name: "Further Maths" },
    { slug: "ielts", name: "IELTS" },
    { slug: "python", name: "Python" },
  ];

  it("prefers an exact name, case-insensitively", () => {
    expect(matchSubject("maths", subjects)?.slug).toBe("maths");
    expect(matchSubject("  IELTS ", subjects)?.slug).toBe("ielts");
  });

  it("then a name that starts with the text, then one that contains it", () => {
    expect(matchSubject("pyth", subjects)?.slug).toBe("python");
    expect(matchSubject("further", subjects)?.slug).toBe("further-maths");
    expect(matchSubject("elt", subjects)?.slug).toBe("ielts");
  });

  it("returns null for blank text or no match, never a guess", () => {
    expect(matchSubject("", subjects)).toBeNull();
    expect(matchSubject("underwater basket weaving", subjects)).toBeNull();
  });
});
