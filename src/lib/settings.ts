import "server-only";
import { cache } from "react";
import { db } from "@/db";
import { platformSettings } from "@/db/schema";

/**
 * Cached platform_settings accessor (SPEC §13). `getSettings` is memoized per
 * request; typed helpers read individual keys. The USD↔credits rate is provisional
 * (seeded), so it lives here and in settings — never hardcoded in feature code.
 */
export const getSettings = cache(
  async (): Promise<Record<string, unknown>> => {
    const rows = await db
      .select({ key: platformSettings.key, value: platformSettings.value })
      .from(platformSettings);
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  },
);

const DEFAULT_CREDIT_USD_RATE = 0.5;

/** USD per 1 credit. Falls back to the seed default if unset/invalid. */
export async function getCreditUsdRate(): Promise<number> {
  const v = Number((await getSettings()).credit_usd_rate);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_CREDIT_USD_RATE;
}
