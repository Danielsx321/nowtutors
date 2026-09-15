import { describe, expect, it } from "vitest";
import { PLATFORM_SETTINGS, seededSetting } from "@/db/platform-settings-defaults";
import {
  SETTING_DEFINITIONS,
  validateSettingValue,
} from "@/lib/settings-schema";
import {
  parseCreditPackages,
  requireDirectPayBasisPackage,
} from "@/lib/credits/packages";
import { parsePayoutRate } from "@/lib/withdrawals/payout-rate";

/**
 * The `/admin/settings` rules (SPEC §4.7; Phase 8 Part 4). The editor must be
 * stricter than the accessors in `lib/settings.ts`: anything it accepts, the
 * accessor reads as-is, with no fallback to the seed.
 */

const ok = (key: string, value: unknown) => validateSettingValue(key, JSON.stringify(value));
const refusal = (key: string, text: string) => {
  const res = validateSettingValue(key, text);
  if (res.ok) throw new Error(`expected ${key}=${text} to be refused`);
  return res;
};

describe("the editable key list", () => {
  it("covers exactly the seeded keys", () => {
    expect(SETTING_DEFINITIONS.map((d) => d.key).sort()).toEqual(
      PLATFORM_SETTINGS.map((s) => s.key).sort(),
    );
  });

  it("accepts every seeded value (except the read-only key)", () => {
    for (const s of PLATFORM_SETTINGS) {
      const res = ok(s.key, s.value);
      if (s.key === "cancellation_enabled") {
        expect(res).toMatchObject({ ok: false, reason: "read_only" });
      } else {
        expect(res, s.key).toEqual({ ok: true, value: s.value });
      }
    }
  });

  it("refuses an unknown key", () => {
    expect(refusal("credit_usd_rate", "1").reason).toBe("unknown_key");
  });

  it("refuses text that isn't JSON", () => {
    expect(refusal("platform_fee_percent", "25%").reason).toBe("not_json");
    expect(refusal("session_durations", "[30, 60").reason).toBe("not_json");
  });

  it("refuses a number sent as a string", () => {
    expect(refusal("platform_fee_percent", '"25"').reason).toBe("invalid");
  });
});

describe("whole-number keys", () => {
  it.each([
    ["platform_fee_percent", 0, 100, [-1, 101, 12.5]],
    ["earnings_hold_hours", 0, 720, [-1, 721, 1.5]],
    ["instant_request_ttl_seconds", 15, 600, [14, 601, 60.5]],
    ["min_booking_notice_minutes", 0, 10_080, [-1, 10_081, 0.5]],
    ["max_booking_days_ahead", 1, 90, [0, 91, 7.5]],
  ] as const)("%s accepts %d to %d and refuses %j", (key, min, max, bad) => {
    expect(ok(key, min).ok).toBe(true);
    expect(ok(key, max).ok).toBe(true);
    for (const v of bad) expect(ok(key, v).ok, `${key}=${v}`).toBe(false);
  });
});

describe("money keys", () => {
  it("min_withdrawal_usd: at least 1, at most 2 decimals", () => {
    expect(ok("min_withdrawal_usd", 30).ok).toBe(true);
    expect(ok("min_withdrawal_usd", 29.99).ok).toBe(true);
    expect(ok("min_withdrawal_usd", 0.5).ok).toBe(false);
    expect(ok("min_withdrawal_usd", 30.001).ok).toBe(false);
  });

  it("payout_usd_per_credit: above 0, at most 4 decimals, and the accessor agrees", () => {
    for (const v of [1, 1.2345, 0.0001]) {
      expect(ok("payout_usd_per_credit", v).ok, String(v)).toBe(true);
      expect(parsePayoutRate(v)).toBe(v);
    }
    for (const v of [0, -1, 1.00005, 101]) {
      expect(ok("payout_usd_per_credit", v).ok, String(v)).toBe(false);
    }
  });
});

describe("session_durations", () => {
  it("accepts a list of unique whole minutes", () => {
    expect(ok("session_durations", [30, 45, 60]).ok).toBe(true);
  });

  it.each([
    [[]],
    [[30, 30]],
    [[10]],
    [[30, 60.5]],
    [30],
    [["30"]],
  ])("refuses %j", (value) => {
    expect(ok("session_durations", value).ok).toBe(false);
  });
});

describe("cancellation_enabled", () => {
  it("can't be edited, even to its current value", () => {
    expect(refusal("cancellation_enabled", "false").reason).toBe("read_only");
    expect(refusal("cancellation_enabled", "true").reason).toBe("read_only");
  });
});

describe("credit_packages", () => {
  const seeded = seededSetting<Record<string, unknown>[]>("credit_packages");
  const withBasis = (flags: boolean[]) =>
    seeded.map((p, i) => {
      const rest = { ...p };
      delete rest.is_direct_pay_basis;
      return flags[i] ? { ...rest, is_direct_pay_basis: true } : rest;
    });

  it("refuses zero or two direct-pay basis packages", () => {
    const none = refusal("credit_packages", JSON.stringify(withBasis([])));
    expect(none.message).toMatch(/Exactly one/);
    const two = refusal("credit_packages", JSON.stringify(withBasis([true, true])));
    expect(two.message).toMatch(/found 2/);
  });

  it("refuses a duplicate id", () => {
    const dup = [...seeded, { ...seeded[0], is_direct_pay_basis: false }];
    expect(refusal("credit_packages", JSON.stringify(dup)).message).toMatch(/used twice/);
  });

  it("refuses an unknown field (a typo like price instead of price_usd)", () => {
    const typo = seeded.map((p, i) => (i === 0 ? { ...p, price: 9.99 } : p));
    expect(ok("credit_packages", typo).ok).toBe(false);
  });

  it.each([
    ["zero credits", { credits: 0 }],
    ["fractional credits", { credits: 5.5 }],
    ["a three-decimal price", { price_usd: 9.999 }],
    ["a missing price", { price_usd: undefined }],
    ["an uppercase id", { id: "Starter" }],
    ["a blank name", { name: "  " }],
  ])("refuses %s", (_label, patch) => {
    const bad = seeded.map((p, i) => (i === 0 ? { ...p, ...patch } : p));
    expect(ok("credit_packages", bad).ok).toBe(false);
  });

  it("refuses an empty list and a non-list", () => {
    expect(ok("credit_packages", []).ok).toBe(false);
    expect(ok("credit_packages", { starter: 5 }).ok).toBe(false);
  });

  it("stores the trimmed name", () => {
    const padded = seeded.map((p, i) => (i === 0 ? { ...p, name: "  Starter  " } : p));
    const res = ok("credit_packages", padded);
    expect(res.ok && (res.value as { name: string }[])[0].name).toBe("Starter");
  });

  it("anything it accepts, the checkout parser reads in full with one basis", () => {
    const moved = withBasis([false, false, false, true, false]);
    const res = ok("credit_packages", moved);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const parsed = parseCreditPackages(res.value);
    expect(parsed).toHaveLength(moved.length);
    expect(requireDirectPayBasisPackage(parsed).id).toBe("pro");
  });
});
