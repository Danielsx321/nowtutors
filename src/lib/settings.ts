import "server-only";
import { cache } from "react";
import { db } from "@/db";
import { platformSettings } from "@/db/schema";

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
