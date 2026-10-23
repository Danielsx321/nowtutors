import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Security D (2026-10-23): the Turnstile token. Without a site key the field is
 * optional (local dev, CI); with one, every password form must send it. The
 * four Supabase calls carry it as `options.captchaToken`, and Supabase's
 * captcha refusal becomes one friendly sentence in the usual `{ error }` shape.
 */

const KEY = "1x00000000000000000000AA"; // Cloudflare's published always-pass test key
const CAPTCHA = "Please complete the check and try again.";

const m = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  reset: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "nowtutors.test", "x-forwarded-proto": "https" }),
}));
vi.mock("@/db", () => {
  const chain = { from: () => chain, where: () => chain, limit: async () => [{ role: "student" }] };
  return { db: { select: () => chain } };
});
vi.mock("@/db/schema", () => ({ profiles: {} }));
vi.mock("@/lib/auth/guards", () => ({
  homeFor: { student: "/dashboard" },
  requireUser: async () => ({ id: "u1", email: "sam@example.com" }),
  getSessionProfile: async () => ({ role: "student" }),
  getVerifiedUser: async () => ({ email: "sam@example.com", app_metadata: { providers: ["email"] } }),
}));
vi.mock("@/lib/security/client-ip", () => ({ getClientIp: async () => "203.0.113.7" }));
vi.mock("@/lib/security/rate-limit", () => ({
  checkRateLimit: async () => ({ ok: true }),
  RATE_LIMIT_MESSAGE: "Too many attempts. Try again in a few minutes.",
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signInWithPassword: (...a: unknown[]) => m.signIn(...a),
      signUp: (...a: unknown[]) => m.signUp(...a),
      resetPasswordForEmail: (...a: unknown[]) => m.reset(...a),
      updateUser: (...a: unknown[]) => m.updateUser(...a),
    },
  }),
}));

/** Fresh copies of the modules, so the build-time env read sees `key`. */
async function load(key: string | undefined) {
  vi.resetModules();
  if (key === undefined) vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
  else vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", key);
  return {
    schemas: await import("@/lib/auth/schemas"),
    captcha: await import("@/lib/auth/captcha"),
    auth: await import("@/actions/auth"),
    settings: await import("@/actions/settings"),
  };
}

const PW = { password: "Passw0rd1", confirmPassword: "Passw0rd1" };
const CHANGE = { currentPassword: "OldPassw0rd", ...PW };
const CAPTCHA_REFUSAL = {
  name: "AuthApiError",
  status: 400,
  code: "captcha_failed",
  message: "captcha protection: request disallowed (invalid-input-response)",
};

beforeEach(() => {
  vi.clearAllMocks();
  m.signIn.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  m.signUp.mockResolvedValue({ data: { session: null }, error: null });
  m.reset.mockResolvedValue({ data: {}, error: null });
  m.updateUser.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("captcha schemas", () => {
  it("without a site key the token is optional on all four forms", async () => {
    const { schemas, captcha } = await load(undefined);
    expect(captcha.CAPTCHA_REQUIRED).toBe(false);
    expect(schemas.loginSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(true);
    expect(schemas.signupSchema.safeParse({ email: "a@b.co", ...PW }).success).toBe(true);
    expect(schemas.forgotPasswordSchema.safeParse({ email: "a@b.co" }).success).toBe(true);
    expect(schemas.changePasswordSchema.safeParse(CHANGE).success).toBe(true);
  });

  it("with a site key a missing or blank token fails with the friendly message", async () => {
    const { schemas, captcha } = await load(KEY);
    expect(captcha.CAPTCHA_REQUIRED).toBe(true);
    const cases = [
      [schemas.loginSchema, { email: "a@b.co", password: "x" }],
      [schemas.signupSchema, { email: "a@b.co", ...PW }],
      [schemas.forgotPasswordSchema, { email: "a@b.co" }],
      [schemas.changePasswordSchema, CHANGE],
    ] as const;
    for (const [schema, values] of cases) {
      for (const token of [undefined, "", "   "]) {
        const r = schema.safeParse({ ...values, captchaToken: token });
        expect(r.success).toBe(false);
        expect(r.error && schemas.failedOnCaptcha(r.error)).toBe(true);
        expect(r.error?.issues.find((i) => i.path[0] === "captchaToken")?.message).toBe(CAPTCHA);
      }
      expect(schema.safeParse({ ...values, captchaToken: "tok" }).success).toBe(true);
    }
  });

  it("recognises Supabase's captcha refusal by code or message, nothing else", async () => {
    const { captcha } = await load(undefined);
    expect(captcha.isCaptchaError(CAPTCHA_REFUSAL)).toBe(true);
    expect(captcha.isCaptchaError({ message: "captcha verification process failed" })).toBe(true);
    expect(captcha.isCaptchaError({ code: "invalid_credentials", message: "Invalid login credentials" })).toBe(
      false,
    );
    expect(captcha.isCaptchaError(null)).toBe(false);
  });
});

describe("captcha wiring, site key set", () => {
  it("login sends the token and maps a refusal; no token never reaches Supabase", async () => {
    const { auth } = await load(KEY);
    await expect(auth.login({ email: "a@b.co", password: "x" })).resolves.toEqual({ error: CAPTCHA });
    expect(m.signIn).not.toHaveBeenCalled();

    await expect(auth.login({ email: "a@b.co", password: "x", captchaToken: "tok" })).rejects.toThrow(
      "redirect:/dashboard",
    );
    expect(m.signIn).toHaveBeenCalledWith({
      email: "a@b.co",
      password: "x",
      options: { captchaToken: "tok" },
    });

    m.signIn.mockResolvedValue({ data: { user: null }, error: CAPTCHA_REFUSAL });
    await expect(auth.login({ email: "a@b.co", password: "x", captchaToken: "used" })).resolves.toEqual({
      error: CAPTCHA,
    });
    // A wrong password is still the same neutral answer.
    m.signIn.mockResolvedValue({ data: { user: null }, error: { code: "invalid_credentials", message: "bad" } });
    await expect(auth.login({ email: "a@b.co", password: "x", captchaToken: "tok" })).resolves.toEqual({
      error: "Invalid email or password.",
    });
  });

  it("signup sends the token beside the redirect and maps a refusal", async () => {
    const { auth } = await load(KEY);
    await expect(auth.signup({ email: "a@b.co", ...PW })).resolves.toEqual({ error: CAPTCHA });
    expect(m.signUp).not.toHaveBeenCalled();

    await expect(auth.signup({ email: "a@b.co", ...PW, captchaToken: "tok" })).resolves.toMatchObject({ ok: true });
    expect(m.signUp).toHaveBeenCalledWith({
      email: "a@b.co",
      password: "Passw0rd1",
      options: { emailRedirectTo: "https://nowtutors.test/auth/callback?next=/onboarding", captchaToken: "tok" },
    });

    m.signUp.mockResolvedValue({ data: { session: null }, error: CAPTCHA_REFUSAL });
    await expect(auth.signup({ email: "a@b.co", ...PW, captchaToken: "tok" })).resolves.toEqual({ error: CAPTCHA });
  });

  it("the reset request sends the token, maps a refusal, and stays neutral otherwise", async () => {
    const { auth } = await load(KEY);
    await expect(auth.requestPasswordReset({ email: "a@b.co" })).resolves.toEqual({ error: CAPTCHA });
    expect(m.reset).not.toHaveBeenCalled();

    await expect(auth.requestPasswordReset({ email: "a@b.co", captchaToken: "tok" })).resolves.toMatchObject({
      ok: true,
    });
    expect(m.reset).toHaveBeenCalledWith("a@b.co", {
      redirectTo: "https://nowtutors.test/auth/callback?next=/reset-password",
      captchaToken: "tok",
    });

    m.reset.mockResolvedValue({ data: null, error: CAPTCHA_REFUSAL });
    await expect(auth.requestPasswordReset({ email: "a@b.co", captchaToken: "tok" })).resolves.toEqual({
      error: CAPTCHA,
    });
    m.reset.mockResolvedValue({ data: null, error: { code: "unexpected_failure", message: "boom" } });
    await expect(auth.requestPasswordReset({ email: "a@b.co", captchaToken: "tok" })).resolves.toMatchObject({
      ok: true,
    });
  });

  it("change password sends the token on the current-password check and maps a refusal", async () => {
    const { settings } = await load(KEY);
    await expect(settings.changePassword(CHANGE)).resolves.toEqual({ error: CAPTCHA });
    expect(m.signIn).not.toHaveBeenCalled();

    await expect(settings.changePassword({ ...CHANGE, captchaToken: "tok" })).resolves.toEqual({ ok: true });
    expect(m.signIn).toHaveBeenCalledWith({
      email: "sam@example.com",
      password: "OldPassw0rd",
      options: { captchaToken: "tok" },
    });

    m.signIn.mockResolvedValue({ data: { user: null }, error: CAPTCHA_REFUSAL });
    await expect(settings.changePassword({ ...CHANGE, captchaToken: "tok" })).resolves.toEqual({ error: CAPTCHA });
    expect(m.updateUser).toHaveBeenCalledTimes(1); // only the successful try changed it
  });
});

describe("captcha wiring, no site key", () => {
  it("everything works without a token, as before", async () => {
    const { auth, settings } = await load(undefined);
    await expect(auth.login({ email: "a@b.co", password: "x" })).rejects.toThrow("redirect:/dashboard");
    expect(m.signIn).toHaveBeenLastCalledWith({
      email: "a@b.co",
      password: "x",
      options: { captchaToken: undefined },
    });
    await expect(auth.signup({ email: "a@b.co", ...PW })).resolves.toMatchObject({ ok: true });
    await expect(auth.requestPasswordReset({ email: "a@b.co" })).resolves.toMatchObject({ ok: true });
    await expect(settings.changePassword(CHANGE)).resolves.toEqual({ ok: true });
  });
});
