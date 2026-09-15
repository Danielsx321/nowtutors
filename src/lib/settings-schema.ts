import { z } from "zod";
import { parsePayoutRate } from "@/lib/withdrawals/payout-rate";

/**
 * What `/admin/settings` may write to `platform_settings` (SPEC §4.7, §6;
 * Phase 8 Part 4).
 *
 * **Stricter than the readers, on purpose.** The typed accessors in
 * `lib/settings.ts` coerce and fall back to the seeded value when a row is
 * garbage, so a bad edit never reaches a price or a payout as `NaN`. That is the
 * right behaviour for a reader and the wrong one for an editor: a fallback would
 * make a typo *look* saved while the platform quietly kept running on the seed.
 * So the editor refuses anything an accessor would have had to coerce, and the
 * admin sees why.
 *
 * **Unknown keys are refused.** Every key a feature reads is listed here; a key
 * nothing reads is a setting that does nothing, and a typo'd key is a silent
 * no-op. A unit test pins this list to `PLATFORM_SETTINGS`.
 *
 * Pure and DB-free, so every rule is unit-tested without Postgres.
 */

export type SettingInputKind = "number" | "json";

export interface SettingDefinition {
  key: string;
  label: string;
  help: string;
  input: SettingInputKind;
  /** Set when the key is shown but must not be edited, with the reason. */
  readOnlyReason?: string;
  schema: z.ZodType<unknown>;
}

const twoDecimals = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

function wholeNumber(min: number, max: number, unit: string) {
  return z
    .number({ error: "Enter a number." })
    .int("Must be a whole number.")
    .min(min, `Must be at least ${min} ${unit}.`)
    .max(max, `Must be at most ${max} ${unit}.`);
}

const creditPackageSchema = z.strictObject({
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Package ids use lowercase letters, digits and dashes."),
  name: z.string().trim().min(1, "Every package needs a name.").max(60),
  credits: wholeNumber(1, 100_000, "credits"),
  price_usd: z
    .number({ error: "Every package needs a price_usd number." })
    .positive("Prices must be above 0.")
    .max(10_000, "Prices must be at most 10000 USD.")
    .refine(twoDecimals, "Prices have at most 2 decimals."),
  is_direct_pay_basis: z.boolean().optional(),
});

const creditPackagesSchema = z
  .array(creditPackageSchema, { error: "Must be a list of packages." })
  .min(1, "Keep at least one package.")
  .max(12, "At most 12 packages.")
  .superRefine((packages, ctx) => {
    const ids = packages.map((p) => p.id);
    const dupe = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dupe) {
      ctx.addIssue({ code: "custom", message: `Package id "${dupe}" is used twice.` });
    }
    // `requireDirectPayBasisPackage` throws on zero or two, which would fail
    // every direct-pay checkout. Refuse the edit instead (SPEC §7.6).
    const basis = packages.filter((p) => p.is_direct_pay_basis === true).length;
    if (basis !== 1) {
      ctx.addIssue({
        code: "custom",
        message: `Exactly one package must have "is_direct_pay_basis": true (found ${basis}).`,
      });
    }
  });

export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  {
    key: "platform_fee_percent",
    label: "Platform fee (%)",
    help: "Share of each session the platform keeps. Applies to sessions completed after the change.",
    input: "number",
    schema: wholeNumber(0, 100, "percent"),
  },
  {
    key: "earnings_hold_hours",
    label: "Earnings hold (hours)",
    help: "How long a tutor's earnings stay held after a session ends. Applies to sessions completed after the change.",
    input: "number",
    schema: wholeNumber(0, 720, "hours"),
  },
  {
    key: "instant_request_ttl_seconds",
    label: "Instant request window (seconds)",
    help: "How long a tutor has to accept an instant request.",
    input: "number",
    schema: wholeNumber(15, 600, "seconds"),
  },
  {
    key: "min_withdrawal_usd",
    label: "Minimum withdrawal (USD)",
    help: "Tutors can't request a payout below this.",
    input: "number",
    schema: z
      .number({ error: "Enter a number." })
      .min(1, "Must be at least 1 USD.")
      .max(10_000, "Must be at most 10000 USD.")
      .refine(twoDecimals, "At most 2 decimals."),
  },
  {
    key: "payout_usd_per_credit",
    label: "Payout rate (USD per credit)",
    help: "What a tutor is paid per credit at withdrawal. Open requests keep the amount they were created with.",
    input: "number",
    schema: z
      .number({ error: "Enter a number." })
      .max(100, "Must be at most 100 USD per credit.")
      .refine((n) => parsePayoutRate(n) !== null, "Must be above 0 with at most 4 decimals."),
  },
  {
    key: "min_booking_notice_minutes",
    label: "Minimum booking notice (minutes)",
    help: "How far ahead a scheduled session must be booked.",
    input: "number",
    schema: wholeNumber(0, 10_080, "minutes"),
  },
  {
    key: "max_booking_days_ahead",
    label: "Booking horizon (days)",
    help: "How far ahead students can book.",
    input: "number",
    schema: wholeNumber(1, 90, "days"),
  },
  {
    key: "session_durations",
    label: "Session lengths (minutes)",
    help: "The lengths students can pick, as a JSON list, for example [30, 60, 90, 120].",
    input: "json",
    schema: z
      .array(wholeNumber(15, 240, "minutes"), { error: "Must be a list of minutes." })
      .min(1, "Keep at least one length.")
      .max(8, "At most 8 lengths.")
      .refine((d) => new Set(d).size === d.length, "Each length may appear once."),
  },
  {
    key: "cancellation_enabled",
    label: "User cancellation",
    help: "Whether students and tutors can cancel bookings themselves.",
    input: "json",
    readOnlyReason:
      "There is no user cancel path in v1 (SPEC §7.3) and nothing reads this key, so changing it would do nothing.",
    schema: z.literal(false),
  },
  {
    key: "credit_packages",
    label: "Credit packages",
    help: "JSON list of { id, name, credits, price_usd } with exactly one is_direct_pay_basis: true. Orders already created keep their own price.",
    input: "json",
    schema: creditPackagesSchema,
  },
];

export function getSettingDefinition(key: string): SettingDefinition | undefined {
  return SETTING_DEFINITIONS.find((d) => d.key === key);
}

export type SettingValidation =
  | { ok: true; value: unknown }
  | {
      ok: false;
      reason: "unknown_key" | "read_only" | "not_json" | "invalid";
      message: string;
    };

/** Longest JSON text the editor accepts. The packages list is well under this. */
export const MAX_SETTING_TEXT = 20_000;

/**
 * Validate the editor's text for `key`. The text is JSON (a number input's
 * "25" is JSON too). Returns the parsed, schema-checked value to store.
 */
export function validateSettingValue(key: string, text: string): SettingValidation {
  const def = getSettingDefinition(key);
  if (!def) {
    return { ok: false, reason: "unknown_key", message: "That setting can't be edited here." };
  }
  if (def.readOnlyReason) {
    return { ok: false, reason: "read_only", message: def.readOnlyReason };
  }
  if (text.length > MAX_SETTING_TEXT) {
    return { ok: false, reason: "invalid", message: "That value is too long." };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {
      ok: false,
      reason: "not_json",
      message: def.input === "number" ? "Enter a number." : "That isn't valid JSON.",
    };
  }
  const parsed = def.schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid",
      message: parsed.error.issues[0]?.message ?? "That value isn't allowed.",
    };
  }
  return { ok: true, value: parsed.data };
}
