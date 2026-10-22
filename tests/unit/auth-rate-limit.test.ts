import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Security C (2026-10-22): sign-in, sign-up and the reset request are counted
 * before Supabase is asked, and a refusal is the usual `{ error }` shape.
 */

const m = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1", host: "nowtutors.test" }),
}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({ profiles: {} }));
vi.mock("@/lib/auth/guards", () => ({ homeFor: {} }));
vi.mock("@/lib/security/rate-limit", () => ({
  checkRateLimit: (...a: unknown[]) => m.rateLimit(...a),
  RATE_LIMIT_MESSAGE: "Too many attempts. Try again in a few minutes.",
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signInWithPassword: (...a: unknown[]) => m.signIn(...a),
      signUp: (...a: unknown[]) => m.signUp(...a),
      resetPasswordForEmail: (...a: unknown[]) => m.reset(...a),
    },
  }),
}));

const { login, signup, requestPasswordReset } = await import("@/actions/auth");
const LIMITED = { error: "Too many attempts. Try again in a few minutes." };

beforeEach(() => {
  vi.clearAllMocks();
  m.rateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 60 });
});

describe("auth rate limits", () => {
  it("login counts the visitor IP and the lowercased email, and never reaches Supabase when limited", async () => {
    await expect(login({ email: "Ada@Example.com", password: "x" })).resolves.toEqual(LIMITED);
    expect(m.rateLimit).toHaveBeenCalledWith({ action: "signIn", ip: "203.0.113.7", email: "ada@example.com" });
    expect(m.signIn).not.toHaveBeenCalled();
  });

  it("an allowed login goes on to Supabase as before", async () => {
    m.rateLimit.mockResolvedValue({ ok: true });
    m.signIn.mockResolvedValue({ data: { user: null }, error: { message: "bad" } });
    await expect(login({ email: "ada@example.com", password: "x" })).resolves.toEqual({
      error: "Invalid email or password.",
    });
    expect(m.signIn).toHaveBeenCalledTimes(1);
  });

  it("signup counts the visitor IP", async () => {
    await expect(
      signup({ email: "ada@example.com", password: "Passw0rd1", confirmPassword: "Passw0rd1" }),
    ).resolves.toEqual(LIMITED);
    expect(m.rateLimit).toHaveBeenCalledWith({ action: "signUp", ip: "203.0.113.7" });
    expect(m.signUp).not.toHaveBeenCalled();
  });

  it("the reset request counts the email, and a bad email is still the neutral answer", async () => {
    await expect(requestPasswordReset({ email: "ada@example.com" })).resolves.toEqual(LIMITED);
    expect(m.rateLimit).toHaveBeenCalledWith({ action: "passwordReset", email: "ada@example.com" });
    expect(m.reset).not.toHaveBeenCalled();
    m.rateLimit.mockClear();
    await expect(requestPasswordReset({ email: "nope" })).resolves.toMatchObject({ ok: true });
    expect(m.rateLimit).not.toHaveBeenCalled();
  });
});
