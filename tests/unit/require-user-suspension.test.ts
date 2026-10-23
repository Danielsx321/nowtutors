import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Security C (2026-10-22): `requireUser()` refuses a suspended account the way
 * `requireRole()` always did, so the role-free actions (settings, change
 * password, messaging, the session room, onboarding) are closed to it too.
 * The suspended page and `signOut` call no guard, so a suspended person can
 * still see why and log out.
 */

const m = vi.hoisted(() => ({
  claims: { sub: "user-1", email: "sam@example.com" } as Record<string, unknown> | null,
  profile: null as null | { id: string; role: string | null; onboardingCompletedAt: Date | null; isSuspended: boolean },
  signOut: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/db", () => {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: async () => (m.profile ? [m.profile] : []),
  };
  return { db: { select: () => chain } };
});
vi.mock("@/db/schema", () => ({ profiles: {}, tutorProfiles: {} }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({ data: m.claims ? { claims: m.claims } : null, error: null }),
      signOut: (...a: unknown[]) => m.signOut(...a),
    },
  }),
}));
vi.mock("@/lib/security/rate-limit", () => ({ checkRateLimit: async () => ({ ok: true }), RATE_LIMIT_MESSAGE: "x" }));

const { requireUser, requireRole } = await import("@/lib/auth/guards");
const { signOut } = await import("@/actions/auth");

const profile = (over: Partial<NonNullable<typeof m.profile>> = {}) => ({
  id: "user-1",
  role: "student",
  onboardingCompletedAt: new Date(),
  isSuspended: false,
  ...over,
});

beforeEach(() => {
  m.claims = { sub: "user-1", email: "sam@example.com" };
  m.profile = profile();
  m.signOut.mockReset();
});

describe("requireUser and suspension", () => {
  it("passes an active user through", async () => {
    await expect(requireUser()).resolves.toEqual({ id: "user-1", email: "sam@example.com" });
  });

  it("sends a suspended user to /suspended, like requireRole", async () => {
    m.profile = profile({ isSuspended: true });
    await expect(requireUser()).rejects.toThrow("redirect:/suspended");
    await expect(requireRole("student")).rejects.toThrow("redirect:/suspended");
  });

  it("suspends before onboarding too: a suspended account with no role cannot onboard", async () => {
    m.profile = profile({ isSuspended: true, role: null });
    await expect(requireUser()).rejects.toThrow("redirect:/suspended");
  });

  it("still sends nobody to /login, and a user with no profile row is not treated as suspended", async () => {
    m.claims = null;
    await expect(requireUser()).rejects.toThrow("redirect:/login");
    m.claims = { sub: "user-1" };
    m.profile = null;
    await expect(requireUser()).resolves.toMatchObject({ id: "user-1" });
  });

  it("a suspended user can still sign out (no guard, so no loop back to /suspended)", async () => {
    m.profile = profile({ isSuspended: true });
    await expect(signOut()).rejects.toThrow("redirect:/login");
    expect(m.signOut).toHaveBeenCalledTimes(1);
  });
});
