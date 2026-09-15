import "server-only";
import { asc, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { auditLog, platformSettings } from "@/db/schema";
import { PLATFORM_SETTINGS } from "@/db/platform-settings-defaults";

/**
 * `platform_settings` reads and the one write behind `/admin/settings`
 * (SPEC §4.7, §6; Phase 8 Part 4).
 */

export interface PlatformSettingRow {
  key: string;
  value: unknown;
  description: string | null;
  updatedAt: Date;
}

export async function listPlatformSettings(): Promise<PlatformSettingRow[]> {
  return db
    .select({
      key: platformSettings.key,
      value: platformSettings.value,
      description: platformSettings.description,
      updatedAt: platformSettings.updatedAt,
    })
    .from(platformSettings)
    .orderBy(asc(platformSettings.key));
}

export type ApplySettingResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: "stale" };

/**
 * Write one setting and its audit row, in the caller's transaction.
 *
 * **Refuses a stale edit.** `expected` is the JSON the admin's page was rendered
 * with (`null` when the key had no row). The row is locked and compared **as
 * jsonb in Postgres**, so key order and whitespace in the JSON text don't
 * matter. If another admin saved in between, nothing is written and the caller
 * gets `stale`: the second admin never overwrites a change they didn't see.
 *
 * **An unchanged value writes nothing**, not even an audit row, so the log only
 * holds real changes.
 *
 * The value must already be validated (`validateSettingValue`). This function
 * enforces concurrency and audit, not the per-key rules.
 */
export async function applySettingUpdate(
  tx: DbTransaction,
  input: { key: string; value: unknown; expected: string | null; actorId: string },
): Promise<ApplySettingResult> {
  const next = JSON.stringify(input.value);

  const [current] = Array.from(
    await tx.execute<{ value: unknown; matches: boolean | null }>(sql`
      select value,
             (value = ${input.expected}::jsonb) as matches
        from platform_settings
       where key = ${input.key}
         for update
    `),
  );

  if (!current) {
    if (input.expected !== null) return { ok: false, reason: "stale" };
    const description = PLATFORM_SETTINGS.find((s) => s.key === input.key)?.description ?? null;
    // Two admins adding the same missing key: the loser's insert does nothing
    // and is refused as stale, same as an edit.
    const inserted = await tx.execute<{ key: string }>(sql`
      insert into platform_settings (key, value, description)
      values (${input.key}, ${next}::jsonb, ${description})
      on conflict (key) do nothing
      returning key
    `);
    if (Array.from(inserted).length === 0) return { ok: false, reason: "stale" };
    await tx.insert(auditLog).values({
      actorId: input.actorId,
      action: "setting.update",
      targetType: "platform_setting",
      targetId: null,
      payload: { key: input.key, from: null, to: input.value },
    });
    return { ok: true, changed: true };
  }

  if (input.expected === null || current.matches !== true) {
    return { ok: false, reason: "stale" };
  }

  const updated = await tx.execute<{ key: string }>(sql`
    update platform_settings
       set value = ${next}::jsonb,
           updated_at = now()
     where key = ${input.key}
       and value is distinct from ${next}::jsonb
    returning key
  `);
  if (Array.from(updated).length === 0) return { ok: true, changed: false };

  await tx.insert(auditLog).values({
    actorId: input.actorId,
    action: "setting.update",
    targetType: "platform_setting",
    targetId: null,
    payload: { key: input.key, from: current.value, to: input.value },
  });
  return { ok: true, changed: true };
}
