import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/auth/safe-next";

/** Security C (2026-10-22): the post-auth redirect accepts in-app paths only. */
describe("safeNext", () => {
  it("allows ordinary in-app paths, with query and hash", () => {
    for (const ok of ["/", "/dashboard", "/onboarding", "/reset-password", "/tutors/ada-l?tab=about#reviews", "/tutors/caf%C3%A9"]) {
      expect(safeNext(ok)).toBe(ok);
    }
  });

  it("returns null for nothing", () => {
    expect(safeNext(undefined)).toBeNull();
    expect(safeNext(null)).toBeNull();
    expect(safeNext("")).toBeNull();
  });

  it("refuses anything that does not start with one slash", () => {
    for (const bad of ["https://evil.com", "evil.com", "javascript:alert(1)", " /dashboard", "dashboard"]) {
      expect(safeNext(bad)).toBeNull();
    }
  });

  it("refuses protocol-relative //host", () => {
    expect(safeNext("//evil.com")).toBeNull();
    expect(safeNext("///evil.com")).toBeNull();
  });

  it("refuses a backslash, raw or encoded", () => {
    expect(safeNext("/\\evil.com")).toBeNull();
    expect(safeNext("/\\/evil.com")).toBeNull();
    expect(safeNext("/%5Cevil.com")).toBeNull();
    expect(safeNext("/%5cevil.com")).toBeNull();
    expect(safeNext("/dashboard\\..\\x")).toBeNull();
  });

  it("refuses control characters, raw or encoded", () => {
    expect(safeNext("/\t/evil.com")).toBeNull();
    expect(safeNext("/\n/evil.com")).toBeNull();
    expect(safeNext("/\u0000x")).toBeNull();
    expect(safeNext("/\u007fx")).toBeNull();
    expect(safeNext("/%09/evil.com")).toBeNull();
    expect(safeNext("/%0a/evil.com")).toBeNull();
    expect(safeNext("/%7F")).toBeNull();
  });
});
