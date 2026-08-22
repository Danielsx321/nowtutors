/**
 * Canonical `platform_settings` rows (SPEC §4.7; resolved values §18).
 *
 * Single source of truth: `src/db/seed.ts` writes these into the DB, and
 * DB-independent unit tests import the same constants so a retune here can't
 * silently drift a test from the seeded reality (e.g. availability's notice /
 * horizon cutoffs, SPEC §15). Pure data — no DB, no env — safe to import from
 * anywhere, including the browser-free Vitest environment.
 *
 * Keys removed by §18 (credit_usd_rate, min_withdrawal_credits,
 * cancellation_window_hours, max_instant_minutes, min_instant_credits) are
 * intentionally absent — see docs/DECISIONS.md.
 */
export type PlatformSetting = {
  key: string;
  value: unknown;
  description: string;
};

export const PLATFORM_SETTINGS: PlatformSetting[] = [
  { key: "platform_fee_percent", value: 25, description: "platform fee on earnings; tutor keeps 75% (§18)" },
  { key: "earnings_hold_hours", value: 48, description: "hold before earnings become available (§18)" },
  { key: "instant_request_ttl_seconds", value: 60, description: "instant-request accept window" },
  { key: "min_withdrawal_usd", value: 30, description: "minimum withdrawal in USD; enforced server-side (§18)" },
  { key: "min_booking_notice_minutes", value: 120, description: "min notice before a slot (existing default, kept)" },
  { key: "max_booking_days_ahead", value: 7, description: "how far ahead students can book (§18)" },
  { key: "session_durations", value: [30, 60, 90, 120], description: "fixed duration menu, not tutor-configurable (§18, amended Phase 6 pre-build)" },
  { key: "cancellation_enabled", value: false, description: "no user cancel path; admin force-cancel only (§7.3, §18)" },
  {
    // Real Bubble tiers. No "minutes" column: credits are a purchased currency, not a
    // unit of time (credits-are-money amendment) — see docs/DECISIONS.md.
    //
    // `is_direct_pay_basis` marks the ONE tier whose per-credit price prices a
    // booking direct-pay (SPEC §4.4, §7.6). It sits on the middle tier, so
    // direct-pay costs more per credit than the larger packages and buying
    // credits keeps its volume incentive. Exactly one tier must carry it —
    // zero or two throws rather than mispricing a charge. Retuning direct-pay
    // means moving this flag in settings, never a code change.
    key: "credit_packages",
    value: [
      { id: "starter", name: "Starter", credits: 5, price_usd: 9.99 },
      { id: "standard", name: "Standard", credits: 15, price_usd: 24.99 },
      { id: "popular", name: "Popular", credits: 30, price_usd: 39.99, is_direct_pay_basis: true },
      { id: "pro", name: "Pro", credits: 60, price_usd: 67.99 },
      { id: "premium", name: "Premium", credits: 100, price_usd: 97.99 },
    ],
    description:
      "buyable credit packages: credits + USD price (no minutes column — §18/DECISIONS); is_direct_pay_basis marks the direct-pay pricing basis (§7.6)",
  },
];

/** A seeded setting's value by key. Throws on an unknown key so tests fail loud. */
export function seededSetting<T = unknown>(key: string): T {
  const row = PLATFORM_SETTINGS.find((s) => s.key === key);
  if (!row) throw new Error(`Unknown platform setting: ${key}`);
  return row.value as T;
}
