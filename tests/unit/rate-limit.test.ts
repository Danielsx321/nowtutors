import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Security C (2026-10-22): the app's rate limits. Key building and the
 * mapping from counter answers to a result; the counter itself is
 * `public.hit_rate_limit()` (drizzle/0028), injected here.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: {} }));
const sentry = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => sentry);

const {
  RATE_LIMITS,
  RATE_LIMIT_MESSAGE,
  checkRateLimit,
  rateLimitKeys,
  retryAfterSeconds,
} = await import("@/lib/security/rate-limit");
const { clientIpFrom } = await import("@/lib/security/client-ip");

const MIN = 60;
const HOUR = 3600;

beforeEach(() => sentry.captureException.mockReset());

describe("the limits", () => {
  it("are the agreed numbers", () => {
    expect(RATE_LIMITS.signIn).toEqual([
      { by: "ip", limit: 10, windowSeconds: 15 * MIN },
      { by: "email", limit: 5, windowSeconds: 15 * MIN },
    ]);
    expect(RATE_LIMITS.signUp).toEqual([{ by: "ip", limit: 5, windowSeconds: HOUR }]);
    expect(RATE_LIMITS.passwordReset).toEqual([{ by: "email", limit: 3, windowSeconds: HOUR }]);
    expect(RATE_LIMITS.changePassword).toEqual([{ by: "user", limit: 5, windowSeconds: 15 * MIN }]);
    expect(RATE_LIMITS.createAttachmentUpload).toEqual([{ by: "user", limit: 30, windowSeconds: HOUR }]);
    expect(RATE_LIMITS.startConversation).toEqual([{ by: "user", limit: 20, windowSeconds: HOUR }]);
    expect(RATE_LIMIT_MESSAGE).toBe("Too many attempts. Try again in a few minutes.");
  });
});

describe("rateLimitKeys", () => {
  it("builds action:subject:value keys in rule order, email lowercased and trimmed", () => {
    expect(rateLimitKeys({ action: "signIn", ip: "203.0.113.7", email: "  Ada@Example.COM " })).toEqual([
      { key: "signIn:ip:203.0.113.7", limit: 10, windowSeconds: 900 },
      { key: "signIn:email:ada@example.com", limit: 5, windowSeconds: 900 },
    ]);
    expect(rateLimitKeys({ action: "changePassword", userId: "u-1" })).toEqual([
      { key: "changePassword:user:u-1", limit: 5, windowSeconds: 900 },
    ]);
  });

  it("skips a rule whose subject is missing instead of sharing one bucket", () => {
    expect(rateLimitKeys({ action: "signIn", ip: null, email: "ada@example.com" }).map((k) => k.key)).toEqual([
      "signIn:email:ada@example.com",
    ]);
    expect(rateLimitKeys({ action: "signUp", ip: "  " })).toEqual([]);
    // A subject the action does not use is ignored.
    expect(rateLimitKeys({ action: "signUp", ip: "1.2.3.4", userId: "u-1", email: "a@b.co" })).toHaveLength(1);
  });

  it("caps a very long subject", () => {
    const [k] = rateLimitKeys({ action: "passwordReset", email: `${"a".repeat(1000)}@x.co` });
    expect(k.key.length).toBeLessThanOrEqual("passwordReset:email:".length + 320);
  });
});

describe("retryAfterSeconds", () => {
  it("is the time left in the fixed window, at least one second", () => {
    expect(retryAfterSeconds(900, 0)).toBe(900);
    expect(retryAfterSeconds(900, 1_000)).toBe(899);
    expect(retryAfterSeconds(900, 899_000)).toBe(1);
    expect(retryAfterSeconds(900, 899_999)).toBe(1);
    expect(retryAfterSeconds(3600, 3_600_000 + 600_000)).toBe(3000);
  });
});

describe("checkRateLimit", () => {
  const now = () => 1_000_000; // 1000 s: 100 s into a 900 s window

  it("is ok when every key is under its limit, and counts each key once", async () => {
    const hit = vi.fn(async (k: { key: string }) => k.key.length > 0);
    await expect(checkRateLimit({ action: "signIn", ip: "1.2.3.4", email: "a@b.co" }, { hit, now })).resolves.toEqual({
      ok: true,
    });
    expect(hit.mock.calls.map((c) => c[0].key)).toEqual(["signIn:ip:1.2.3.4", "signIn:email:a@b.co"]);
  });

  it("refuses on the first key over its limit, with the window's time left, and counts no later key", async () => {
    const hit = vi.fn(async () => false);
    await expect(checkRateLimit({ action: "signIn", ip: "1.2.3.4", email: "a@b.co" }, { hit, now })).resolves.toEqual({
      ok: false,
      retryAfterSeconds: 800,
    });
    expect(hit).toHaveBeenCalledTimes(1);
  });

  it("refuses on the email key when the IP key is fine", async () => {
    const hit = vi.fn(async (k: { key: string }) => !k.key.includes(":email:"));
    const res = await checkRateLimit({ action: "signIn", ip: "1.2.3.4", email: "a@b.co" }, { hit, now });
    expect(res).toEqual({ ok: false, retryAfterSeconds: 800 });
    expect(hit).toHaveBeenCalledTimes(2);
  });

  it("with no keys at all, allows without calling the counter", async () => {
    const hit = vi.fn(async () => false);
    await expect(checkRateLimit({ action: "signUp", ip: null }, { hit, now })).resolves.toEqual({ ok: true });
    expect(hit).not.toHaveBeenCalled();
  });

  it("fails open when the counter is unreachable, and reports it", async () => {
    const err = new Error('function public.hit_rate_limit does not exist');
    const hit = vi.fn(async () => {
      throw err;
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(checkRateLimit({ action: "changePassword", userId: "u-1" }, { hit, now })).resolves.toEqual({ ok: true });
    expect(sentry.captureException).toHaveBeenCalledWith(err, expect.anything());
    log.mockRestore();
  });
});

describe("clientIpFrom", () => {
  const h = (o: Record<string, string>) => new Headers(o);

  it("takes the first x-forwarded-for hop", () => {
    expect(clientIpFrom(h({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" }))).toBe("203.0.113.7");
    expect(clientIpFrom(h({ "x-forwarded-for": " 2001:DB8::1 " }))).toBe("2001:db8::1");
  });

  it("falls back to x-real-ip, then to null", () => {
    expect(clientIpFrom(h({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIpFrom(h({ "x-forwarded-for": "", "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIpFrom(h({}))).toBeNull();
  });

  it("refuses a value that is not an address, so a key cannot carry junk", () => {
    expect(clientIpFrom(h({ "x-forwarded-for": "evil:key:injection, 1.2.3.4" }))).toBeNull();
    expect(clientIpFrom(h({ "x-forwarded-for": "<script>" }))).toBeNull();
  });
});
