"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { applySettingUpdate } from "@/db/queries/admin-settings";
import { MAX_SETTING_TEXT, validateSettingValue } from "@/lib/settings-schema";
import { isCronJobName } from "@/lib/cron/job-names";
import {
  cronFailureMessage,
  reportCronFailure,
  runCronJob,
  type CronSummary,
} from "@/lib/cron/jobs";

/**
 * `/admin/settings` actions (SPEC §4.7, §6, §12; Phase 8 Part 4).
 *
 * `requireRole('admin')` is the FIRST statement of each, before any input is
 * read, any job runs or any row is touched (the layout guard is only a
 * redirect, §5 Layer 2). The actor always comes from the guard.
 */

export type UpdateSettingResult = { ok: true; changed: boolean } | { error: string };

const updateSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string().max(MAX_SETTING_TEXT),
  expected: z.string().max(MAX_SETTING_TEXT).nullable(),
});

function isJsonText(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export async function updateSetting(input: {
  key: string;
  value: string;
  expected: string | null;
}): Promise<UpdateSettingResult> {
  const { user } = await requireRole("admin");
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid setting." };
  const { key, value, expected } = parsed.data;

  const checked = validateSettingValue(key, value);
  if (!checked.ok) return { error: checked.message };
  // `expected` is cast to jsonb in SQL; garbage there is a bad request, not a 500.
  if (expected !== null && !isJsonText(expected)) return { error: "Invalid setting." };

  const res = await db.transaction((tx) =>
    applySettingUpdate(tx, { key, value: checked.value, expected, actorId: user.id }),
  );
  if (!res.ok) {
    return {
      error: "Someone changed this setting after you opened the page. Reload to see the current value.",
    };
  }

  // Settings are read per request (`getSettings` is React `cache`, not a
  // cross-request cache), so this only refreshes rendered pages.
  revalidatePath("/", "layout");
  return { ok: true, changed: res.changed };
}

export type RunCronNowResult = { ok: true; summary: CronSummary } | { error: string };

/**
 * Run a §12 job now, server-side (SPEC §12 "run now"). Calls the same function
 * the scheduled route calls; never fetches the cron URL, never touches
 * `CRON_SECRET`. Every job is idempotent, so an extra run is safe.
 *
 * The audit row is written **after** the run so it records what happened
 * (summary or failure). If that insert fails, the job has still run, so the
 * admin is told exactly that rather than a generic error.
 */
export async function runCronNow(input: { job: string }): Promise<RunCronNowResult> {
  const { user } = await requireRole("admin");
  const job = input?.job;
  if (!isCronJobName(job)) return { error: "Unknown job." };

  let outcome: { ok: true; summary: CronSummary } | { ok: false; error: string };
  try {
    outcome = { ok: true, summary: await runCronJob(job) };
  } catch (err) {
    reportCronFailure(job, err);
    outcome = { ok: false, error: cronFailureMessage(job) };
  }

  try {
    await db.insert(auditLog).values({
      actorId: user.id,
      action: "cron.run_now",
      targetType: "cron_job",
      targetId: null,
      payload: outcome.ok ? { job, summary: outcome.summary } : { job, error: outcome.error },
    });
  } catch (err) {
    console.error("[admin/run-now] audit insert failed", err);
    return {
      error: `The job ${outcome.ok ? "ran" : "failed"}, but the audit row could not be written.`,
    };
  }

  revalidatePath("/admin");
  revalidatePath("/admin/audit");
  return outcome.ok ? { ok: true, summary: outcome.summary } : { error: outcome.error };
}
