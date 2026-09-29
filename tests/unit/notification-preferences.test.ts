import { describe, expect, it } from "vitest";
import { allowsEmail, PREFERENCE_BY_TYPE, readPreferences } from "@/lib/email/preferences";
import type { EmailType } from "@/lib/email/types";

/**
 * `profiles.notification_preferences` (SPEC §11): opt-out, missing key = on,
 * marketing off by default, unknown keys tolerated. Part 1's types are all
 * transactional, so they ignore the flags entirely.
 */
describe("notification preferences", () => {
  it("reads the defaults from an empty column", () => {
    expect(readPreferences({})).toMatchObject({
      booking_confirmations: true,
      reminders: true,
      messages: true,
      marketing: false,
    });
  });

  it("treats a missing key as on and keeps an explicit off", () => {
    const prefs = readPreferences({ reminders: false });
    expect(prefs.reminders).toBe(false);
    expect(prefs.messages).toBe(true);
  });

  it("ignores junk rather than failing", () => {
    expect(readPreferences(null).messages).toBe(true);
    expect(readPreferences("nope").messages).toBe(true);
    expect(readPreferences([1, 2]).messages).toBe(true);
    expect(readPreferences({ messages: "yes" }).messages).toBe(true);
    expect(readPreferences({ unknown_flag: false, messages: false }).messages).toBe(false);
  });

  it("sends every Part 1 type whatever the flags say", () => {
    const everythingOff = readPreferences({
      booking_confirmations: false,
      reminders: false,
      messages: false,
      marketing: false,
    });
    for (const type of Object.keys(PREFERENCE_BY_TYPE) as EmailType[]) {
      expect(PREFERENCE_BY_TYPE[type]).toBe("always");
      expect(allowsEmail(everythingOff, type)).toBe(true);
    }
  });
});
