import { requireRole } from "@/lib/auth/guards";
import { getPayoutEmailFor } from "@/db/queries/withdrawals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PayoutEmailForm } from "@/components/features/tutor/payout-email-form";

export const metadata = { title: "Settings · NowTutors" };
export const dynamic = "force-dynamic";

/**
 * `/tutor/settings` (SPEC §6). Phase 8 Part 2 ships only the PayPal payout
 * email, which withdrawals need; the rest of this page arrives in Phase 10.
 * Approval is not required, matching `updatePayoutEmail`.
 */
export default async function TutorSettingsPage() {
  const { user } = await requireRole("tutor", { requireApproval: false });
  const email = await getPayoutEmailFor(user.id);

  return (
    <div className="w-full space-y-6 py-2">
      <h1 className="font-display text-[clamp(28px,3vw,38px)] font-medium leading-tight tracking-[-0.03em] text-text">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>Payouts</CardTitle>
        </CardHeader>
        <CardContent>
          <PayoutEmailForm email={email} />
        </CardContent>
      </Card>
    </div>
  );
}
