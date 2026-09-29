import { requireRole } from "@/lib/auth/guards";
import { SettingsSections } from "@/components/features/settings/settings-sections";

export const metadata = { title: "Settings · NowTutors" };
export const dynamic = "force-dynamic";

/**
 * `/dashboard/settings` (SPEC §6; Phase 10 Part 4): name, timezone, email
 * notifications, password, and how to close the account. Delete account is a
 * note, not a button (DECISIONS, Part 4).
 */
export default async function StudentSettingsPage() {
  const { user } = await requireRole("student");
  return (
    <div className="w-full space-y-6 py-2">
      <h1 className="font-display text-[clamp(28px,3vw,38px)] font-medium leading-tight tracking-[-0.03em] text-text">
        Settings
      </h1>
      <SettingsSections userId={user.id} role="student" />
    </div>
  );
}
