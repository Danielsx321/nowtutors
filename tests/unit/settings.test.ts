import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidTimeZone, timeZoneLabel, timeZoneOptions } from "@/lib/geo/timezones";
import { accountSettingsSchema, changePasswordSchema, tutorOnboardingSchema } from "@/lib/auth/schemas";

/**
 * Settings (Phase 10 Part 4): the timezone rules, the form schemas, and the
 * three actions' authorization and writes. The database and Supabase are
 * mocked; what's under test is what each action accepts, refuses and writes.
 */

const m = vi.hoisted(() => ({
  user: { id: "u1", email: "sam@example.com" } as { id: string; email: string } | null,
  profile: { role: "student" } as { role: string | null } | null,
  authUser: null as unknown,
  writes: [] as Array<Record<string, unknown>>,
  storedPrefs: {} as unknown,
  signIn: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({
  requireUser: async () => {
    if (!m.user) throw new Error("NEXT_REDIRECT");
    return m.user;
  },
  getSessionProfile: async () => m.profile,
  getVerifiedUser: async () => m.authUser,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { signInWithPassword: (...a: unknown[]) => m.signIn(...a), updateUser: (...a: unknown[]) => m.updateUser(...a) },
  }),
}));
vi.mock("@/db", () => {
  const selectChain = { from: () => selectChain, where: () => selectChain, limit: async () => [{ prefs: m.storedPrefs }] };
  return {
    db: {
      select: () => selectChain,
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => {
            m.writes.push(values);
          },
        }),
      }),
    },
  };
});

const { updateAccountSettings, updateNotificationSettings, changePassword } = await import("@/actions/settings");

beforeEach(() => {
  vi.clearAllMocks();
  m.user = { id: "u1", email: "sam@example.com" };
  m.profile = { role: "student" };
  m.writes = [];
  m.storedPrefs = {};
  m.authUser = { email: "sam@example.com", app_metadata: { providers: ["email"] } };
});

describe("timezones", () => {
  it("accepts canonical zones and browser aliases, refuses junk", () => {
    expect(isValidTimeZone("Africa/Lagos")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Asia/Calcutta")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("lists UTC first and labels with the offset", () => {
    const zones = timeZoneOptions();
    expect(zones[0]).toBe("UTC");
    expect(zones).toContain("Africa/Lagos");
    expect(timeZoneLabel("Africa/Lagos", new Date("2026-10-01T12:00:00Z"))).toBe("Africa / Lagos (GMT+1)");
  });
});

describe("schemas", () => {
  it("refuses an invalid timezone on the account form", () => {
    expect(accountSettingsSchema.safeParse({ timezone: "Nowhere/Here" }).success).toBe(false);
    expect(accountSettingsSchema.safeParse({ timezone: "Europe/Madrid" }).success).toBe(true);
  });

  it("requires the new password to differ and to match", () => {
    const base = { currentPassword: "Oldpass123", password: "Newpass123", confirmPassword: "Newpass123" };
    expect(changePasswordSchema.safeParse(base).success).toBe(true);
    expect(changePasswordSchema.safeParse({ ...base, confirmPassword: "Other123" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ ...base, password: "Oldpass123", confirmPassword: "Oldpass123" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ ...base, password: "short", confirmPassword: "short" }).success).toBe(false);
  });

  it("tutor onboarding takes an optional, valid timezone", () => {
    const shape = tutorOnboardingSchema.shape.timezone;
    expect(shape.safeParse(undefined).success).toBe(true);
    expect(shape.safeParse("").success).toBe(true);
    expect(shape.safeParse("Africa/Lagos").success).toBe(true);
    expect(shape.safeParse("Bogus/Zone").success).toBe(false);
  });
});

describe("updateAccountSettings", () => {
  it("writes a student's name and timezone", async () => {
    expect(await updateAccountSettings({ displayName: "Sam S", timezone: "Europe/London" })).toEqual({ ok: true });
    expect(m.writes).toEqual([{ timezone: "Europe/London", displayName: "Sam S" }]);
  });

  it("ignores a name sent by a tutor: that's edited on the profile", async () => {
    m.profile = { role: "tutor" };
    await updateAccountSettings({ displayName: "Someone Else", timezone: "Africa/Lagos" });
    expect(m.writes).toEqual([{ timezone: "Africa/Lagos" }]);
  });

  it("refuses an invalid timezone and writes nothing", async () => {
    const res = await updateAccountSettings({ timezone: "Mars/Olympus" });
    expect(res).toMatchObject({ error: expect.any(String) });
    expect(m.writes).toEqual([]);
  });

  it("refuses before onboarding", async () => {
    m.profile = { role: null };
    expect(await updateAccountSettings({ timezone: "UTC" })).toMatchObject({ error: expect.any(String) });
    expect(m.writes).toEqual([]);
  });
});

describe("updateNotificationSettings", () => {
  it("writes the three switches and keeps keys the form doesn't own", async () => {
    m.storedPrefs = { marketing: true, future_flag: false };
    await updateNotificationSettings({ booking_confirmations: false, reminders: true, messages: false });
    expect(m.writes[0].notificationPreferences).toMatchObject({
      booking_confirmations: false,
      reminders: true,
      messages: false,
      marketing: true,
      future_flag: false,
    });
  });
});

describe("changePassword", () => {
  const input = { currentPassword: "Oldpass123", password: "Newpass123", confirmPassword: "Newpass123" };

  it("checks the current password, then sets the new one", async () => {
    m.signIn.mockResolvedValue({ error: null });
    m.updateUser.mockResolvedValue({ error: null });
    expect(await changePassword(input)).toEqual({ ok: true });
    expect(m.signIn).toHaveBeenCalledWith({ email: "sam@example.com", password: "Oldpass123" });
    expect(m.updateUser).toHaveBeenCalledWith({ password: "Newpass123" });
  });

  it("refuses a wrong current password without touching the new one", async () => {
    m.signIn.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    expect(await changePassword(input)).toEqual({ error: "Your current password isn't right." });
    expect(m.updateUser).not.toHaveBeenCalled();
  });

  it("tells a Google-only account there is no password", async () => {
    m.authUser = { email: "sam@example.com", app_metadata: { providers: ["google"] } };
    expect(await changePassword(input)).toMatchObject({ error: expect.stringContaining("Google") });
    expect(m.signIn).not.toHaveBeenCalled();
  });
});
