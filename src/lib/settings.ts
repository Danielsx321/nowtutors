import "server-only";
import { cache } from "react";
import { db } from "@/db";
import { platformSettings } from "@/db/schema";
import { seededSetting } from "@/db/platform-settings-defaults";

/**
 * Cached platform_settings accessor (SPEC §13). `getSettings` is memoized per
 * request; typed helpers read individual keys. Values live in settings, never
 * hardcoded in feature code.
 */
export const getSettings = cache(
  async (): Promise<Record<string, unknown>> => {
    const rows = await db
      .select({ key: platformSettings.key, value: platformSettings.value })
      .from(platformSettings);
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  },
);

export interface BookingSettings {
  minBookingNoticeMinutes: number;
  maxBookingDaysAhead: number;
  sessionDurations: number[];
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * The booking-flow cutoffs from platform_settings (SPEC §7.3/§18), coerced and
 * defaulted to the seeded values so a missing/edited row can never silently pass
 * a garbage cutoff into slot computation or price checks.
 */
export async function getBookingSettings(): Promise<BookingSettings> {
  const s = await getSettings();
  const durations = Array.isArray(s.session_durations)
    ? (s.session_durations as unknown[]).filter(
        (d): d is number => typeof d === "number" && Number.isFinite(d),
      )
    : (seededSetting<number[]>("session_durations"));
  return {
    minBookingNoticeMinutes: asNumber(
      s.min_booking_notice_minutes,
      seededSetting<number>("min_booking_notice_minutes"),
    ),
    maxBookingDaysAhead: asNumber(
      s.max_booking_days_ahead,
      seededSetting<number>("max_booking_days_ahead"),
    ),
    sessionDurations: durations.length ? durations : seededSetting<number[]>("session_durations"),
  };
}
