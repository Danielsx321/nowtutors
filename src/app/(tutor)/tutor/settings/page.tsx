import { requireRole } from "@/lib/auth/guards";
import { getPayoutEmailFor } from "@/db/queries/withdrawals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PayoutEmailForm } from "@/components/features/tutor/payout-email-form";
import { SettingsSections } from "@/components/features/settings/settings-sections";

export const metadata = { title: "Settings · NowTutors" };
export const dynamic = "force-dynamic";

/**
 * `/tutor/settings` (SPEC §6). Timezone, email notifications and password
 * (Phase 10 Part 4), then the PayPal payout email (Phase 8 Part 2). The name
 * lives on `/tutor/profile`. Approval is not required, matching the actions.
 */
export default async function TutorSettingsPage() {
  const { user } = await requireRole("tutor", { requireApproval: false });
  const email = await getPayoutEmailFor(user.id);

  return (
    <div className="w-full space-y-6 py-2">
      <h1 className="font-display text-[clamp(28px,3vw,38px)] font-medium leading-tight tracking-[-0.03em] text-text">Settings</h1>
      <SettingsSections userId={user.id} role="tutor" />
      <Card>
        <CardHeader>
          <CardTitle as="h2">Payouts</CardTitle>
        </CardHeader>
        <CardContent>
          <PayoutEmailForm email={email} />
        </CardContent>
      </Card>
    </div>
  );
}
