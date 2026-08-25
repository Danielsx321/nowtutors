import "server-only";
import { cache } from "react";
import { db } from "@/db";
import { platformSettings } from "@/db/schema";
import { seededSetting } from "@/db/platform-settings-defaults";
import {
  parseCreditPackages,
  type CreditPackage,
} from "@/lib/credits/packages";

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

export interface EarningsSettings {
  /** Percent of gross the platform keeps. Fed to `splitEarnings` (§7.11). */
  platformFeePercent: number;
  /** Hours between `ended_at` and `available_at` on a held earnings row. */
  earningsHoldHours: number;
}

/**
 * The two earnings tunables from `platform_settings` (SPEC §7.11, §18), coerced
 * and defaulted to the seeded values exactly as {@link getBookingSettings} does.
 *
 * Neither key had an accessor before Phase 6 Part 3C, because nothing in `src/`
 * read them — `platform_fee_percent` and `earnings_hold_hours` were seeded in
 * `platform-settings-defaults.ts` and used only by the seed. The
 * complete-sessions cron is their first caller, and it is the wrong place for an
 * untyped `getSettings()` lookup: these two numbers decide what a tutor is paid
 * and when they may withdraw it, so a missing row or a garbage admin edit must
 * fall back to the seeded value rather than reach `splitEarnings` as `undefined`
 * (which would make the fee `NaN`) or reach the hold arithmetic as a string.
 *
 * The percent is deliberately **not** clamped to 0–100 beyond finiteness here:
 * `splitEarnings` is the authority on the split and this accessor's job is
 * coercion, not policy. It is defaulted, though, so the authority is never
 * handed a non-number.
 */
export async function getEarningsSettings(): Promise<EarningsSettings> {
  const s = await getSettings();
  return {
    platformFeePercent: asNumber(
      s.platform_fee_percent,
      seededSetting<number>("platform_fee_percent"),
    ),
    earningsHoldHours: asNumber(
      s.earnings_hold_hours,
      seededSetting<number>("earnings_hold_hours"),
    ),
  };
}

/**
 * The instant-request accept window in seconds (SPEC §7.4, §4.3): a request's
 * `expires_at` is `now() + this`. Read from `platform_settings`
 * (`instant_request_ttl_seconds`, seeded 60) rather than hardcoded, because
 * §13 keeps tunables in settings — but coerced to a sane positive integer and
 * defaulted to the seeded value, so a garbage edit cannot mint a request that
 * expires in the past or never.
 *
 * This is the COSMETIC countdown's source too. Expiry itself is enforced
 * server-side against `expires_at` on every read and both crons; the client ring
 * only renders the same number.
 */
export async function getInstantRequestTtlSeconds(): Promise<number> {
  const s = await getSettings();
  const seeded = seededSetting<number>("instant_request_ttl_seconds");
  const value = s.instant_request_ttl_seconds;
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : seeded;
}

/**
 * The buyable credit packages (SPEC §4.7 / §18 item 7), read from
 * `platform_settings.credit_packages` and coerced by the pure parser. Falls back
 * to the seeded tiers only when the row is missing or every entry is malformed,
 * so a purchase page never renders an empty shop because of one bad edit.
 */
export async function getCreditPackages(): Promise<CreditPackage[]> {
  const s = await getSettings();
  const parsed = parseCreditPackages(s.credit_packages);
  return parsed.length
    ? parsed
    : parseCreditPackages(seededSetting<unknown>("credit_packages"));
}
