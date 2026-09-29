import { z } from "zod";
import type { EmailType } from "./types";

/**
 * `profiles.notification_preferences` (SPEC §11; `src/db/schema/identity.ts`).
 * Opt-out model: a missing key means "on". The column defaults to `{}`, so a
 * brand-new account receives everything except marketing, and an unknown key
 * written by an older client is ignored rather than failing the read.
 */
export const notificationPreferencesSchema = z
  .object({
    booking_confirmations: z.boolean().default(true),
    reminders: z.boolean().default(true),
    messages: z.boolean().default(true),
    marketing: z.boolean().default(false),
  })
  .loose();

export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;
export type PreferenceKey = keyof NotificationPreferences;

/** A jsonb value from the row, whatever shape it is in, to the four flags. */
export function readPreferences(raw: unknown): NotificationPreferences {
  const parsed = notificationPreferencesSchema.safeParse(
    raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {},
  );
  return parsed.success ? parsed.data : notificationPreferencesSchema.parse({});
}

/**
 * Which preference each type honours. `always` is transactional: money moved,
 * an application decided, an admin who has to act. Those go out whatever the
 * flags say, which is what "honour a notification_preferences jsonb" in §11
 * means for the types a person cannot sensibly opt out of.
 */
export const PREFERENCE_BY_TYPE: Record<EmailType, PreferenceKey | "always"> = {
  "tutor-welcome": "always",
  "tutor-approved": "always",
  "tutor-rejected": "always",
  "withdrawal-requested": "always",
  "withdrawal-paid": "always",
  "withdrawal-rejected": "always",
  "admin-new-tutor-application": "always",
  "admin-new-withdrawal": "always",
};

export function allowsEmail(prefs: NotificationPreferences, type: EmailType): boolean {
  const key = PREFERENCE_BY_TYPE[type];
  // `.loose()` widens the index type; the four known keys are booleans after parse.
  return key === "always" ? true : prefs[key] !== false;
}
