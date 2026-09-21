import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who is signed in, without a network call (performance review P1).
 *
 * `auth.getUser()` asks Supabase Auth over HTTP every time: measured at 220 ms
 * from Lagos against 1 ms for `auth.getClaims()`, which checks the token's
 * signature locally against the project's public key. It ran twice per
 * request, once in middleware and once in the guards.
 *
 * Asserted: the guards and the middleware read claims and never call
 * `getUser`; a missing or bad token is "nobody"; and the email-verification
 * gate, which guards bookings, paid requests and going live, still asks the
 * auth server, because it needs `email_confirmed_at` and a revoked session
 * must not spend money.
 */

const authGetUser = vi.fn();
const authGetClaims = vi.fn();
const supabase = { auth: { getUser: authGetUser, getClaims: authGetClaims } };

vi.mock("server-only", () => ({}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({ profiles: {}, tutorProfiles: {} }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => supabase }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => supabase }));
vi.mock("next/server", () => ({
  NextResponse: { next: () => ({ cookies: { set: vi.fn() } }) },
}));

import { getUser, requireUser, requireVerifiedEmail, EmailNotVerifiedError } from "@/lib/auth/guards";
import { updateSession } from "@/lib/supabase/middleware";

const CLAIMS = { sub: "user-1", email: "student1@nowtutors.dev", role: "authenticated" };

beforeEach(() => {
  authGetUser.mockReset();
  authGetClaims.mockReset();
});

describe("guards read the token locally", () => {
  it("getUser returns id and email from the claims and makes no auth-server call", async () => {
    authGetClaims.mockResolvedValue({ data: { claims: CLAIMS }, error: null });
    await expect(getUser()).resolves.toEqual({ id: "user-1", email: "student1@nowtutors.dev" });
    expect(authGetUser).not.toHaveBeenCalled();
  });

  it("no token, or a token that fails verification, is nobody", async () => {
    authGetClaims.mockResolvedValue({ data: null, error: null });
    await expect(getUser()).resolves.toBeNull();
    authGetClaims.mockResolvedValue({ data: null, error: new Error("invalid JWT") });
    await expect(getUser()).resolves.toBeNull();
    await expect(requireUser()).rejects.toThrow("redirect:/login");
    expect(authGetUser).not.toHaveBeenCalled();
  });

  it("claims without a subject are nobody", async () => {
    authGetClaims.mockResolvedValue({ data: { claims: { role: "anon" } }, error: null });
    await expect(getUser()).resolves.toBeNull();
  });
});

describe("the email-verification gate still asks the auth server", () => {
  it("passes a verified user through, from getUser", async () => {
    authGetUser.mockResolvedValue({
      data: { user: { id: "user-1", email_confirmed_at: "2026-01-01T00:00:00Z" } },
    });
    await expect(requireVerifiedEmail()).resolves.toMatchObject({ id: "user-1" });
    expect(authGetUser).toHaveBeenCalledTimes(1);
  });

  it("refuses an unverified user", async () => {
    authGetUser.mockResolvedValue({ data: { user: { id: "user-1", email_confirmed_at: null } } });
    await expect(requireVerifiedEmail()).rejects.toBeInstanceOf(EmailNotVerifiedError);
  });

  it("a session the auth server no longer knows goes to login, whatever the token says", async () => {
    authGetClaims.mockResolvedValue({ data: { claims: CLAIMS }, error: null });
    authGetUser.mockResolvedValue({ data: { user: null } });
    await expect(requireVerifiedEmail()).rejects.toThrow("redirect:/login");
  });
});

describe("middleware", () => {
  it("refreshes through getClaims and never calls getUser", async () => {
    authGetClaims.mockResolvedValue({ data: { claims: CLAIMS }, error: null });
    const request = { cookies: { getAll: () => [], set: vi.fn() } };
    await updateSession(request as never);
    expect(authGetClaims).toHaveBeenCalledTimes(1);
    expect(authGetUser).not.toHaveBeenCalled();
  });
});
