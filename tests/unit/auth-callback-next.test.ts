import { describe, expect, it, vi } from "vitest";

/** Security C (2026-10-22): `/auth/callback` uses the same `safeNext` as the auth actions. */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      exchangeCodeForSession: async () => ({ error: null }),
      getUser: async () => ({ data: { user: { id: "user-1" } } }),
    },
  }),
}));
vi.mock("@/db", () => {
  const chain = { from: () => chain, where: () => chain, limit: async () => [{ role: "student" }] };
  return { db: { select: () => chain } };
});
vi.mock("@/db/schema", () => ({ profiles: {} }));
vi.mock("@/lib/auth/guards", () => ({ homeFor: { student: "/dashboard", tutor: "/tutor", admin: "/admin" } }));

const { GET } = await import("@/app/auth/callback/route");

const call = async (next: string) => {
  const res = await GET(new Request(`https://nowtutors.test/auth/callback?code=abc&next=${next}`));
  return res.headers.get("location");
};

describe("/auth/callback next", () => {
  it("honours an in-app next", async () => {
    expect(await call("/reset-password")).toBe("https://nowtutors.test/reset-password");
  });

  it("ignores a backslash, protocol-relative or control-character next and goes home", async () => {
    for (const bad of ["/%5Cevil.com", "/%255Cevil.com", "//evil.com", "/%09/evil.com", "https://evil.com"]) {
      expect(await call(bad)).toBe("https://nowtutors.test/dashboard");
    }
  });
});
