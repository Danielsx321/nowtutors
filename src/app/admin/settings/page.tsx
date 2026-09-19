import { requireRole } from "@/lib/auth/guards";
import { listPlatformSettings } from "@/db/queries/admin-settings";
import { SETTING_DEFINITIONS } from "@/lib/settings-schema";
import { CRON_JOB_INFO, CRON_JOB_NAMES } from "@/lib/cron/job-names";
import { Alert } from "@/components/ui/alert";
import {
  SettingsEditor,
  type EditableSetting,
} from "@/components/features/admin/settings-editor";
import { CronRunNow } from "@/components/features/admin/cron-run-now";

export const metadata = { title: "Settings · NowTutors" };
export const dynamic = "force-dynamic";

/**
 * `/admin/settings` (SPEC §4.7, §6, §12; Phase 8 Part 4): the
 * `platform_settings` editor plus a "run now" button for every scheduled job.
 *
 * Each key has its own rules (`lib/settings-schema.ts`), enforced again in the
 * action. `expected` carries the value this page was rendered with, so a save
 * over someone else's newer change is refused rather than silently overwriting.
 *
 * `requireRole('admin')` first, independently of the layout (§5 Layer 2).
 */
export default async function AdminSettingsPage() {
  await requireRole("admin");
  const rows = await listPlatformSettings();

  const settings: EditableSetting[] = SETTING_DEFINITIONS.map((def) => {
    const row = rows.find((r) => r.key === def.key);
    return {
      key: def.key,
      label: def.label,
      help: def.help,
      input: def.input,
      readOnlyReason: def.readOnlyReason ?? null,
      text: row
        ? def.input === "number"
          ? JSON.stringify(row.value)
          : JSON.stringify(row.value, null, 2)
        : null,
      expected: row ? JSON.stringify(row.value) : null,
    };
  });

  const unmanaged = rows.filter((r) => !SETTING_DEFINITIONS.some((d) => d.key === r.key));

  return (
    <div className="w-full space-y-8 py-2">
      <div>
        <h1 className="text-h1 font-bold text-gray-700">Settings</h1>
        <p className="mt-1 text-body text-gray-500">
          Platform settings take effect on the next request. Every change is written to the audit
          log.
        </p>
      </div>

      <section aria-labelledby="platform-settings" className="space-y-4">
        <h2 id="platform-settings" className="text-h2 font-bold text-gray-700">
          Platform settings
        </h2>
        <SettingsEditor settings={settings} />
        {unmanaged.length > 0 && (
          <Alert variant="info" title="Keys not managed here">
            {unmanaged.map((r) => r.key).join(", ")}. Nothing in the app reads these, so they
            can&apos;t be edited from this page.
          </Alert>
        )}
      </section>

      <section aria-labelledby="scheduled-jobs" className="space-y-4">
        <div>
          <h2 id="scheduled-jobs" className="text-h2 font-bold text-gray-700">
            Scheduled jobs
          </h2>
          <p className="mt-1 text-body text-gray-500">
            Runs the same code as the schedule, straight away. Every job is safe to run twice.
          </p>
        </div>
        <CronRunNow jobs={CRON_JOB_NAMES.map((name) => ({ name, ...CRON_JOB_INFO[name] }))} />
      </section>
    </div>
  );
}
