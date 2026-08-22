import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";
import { findPaymentForAdmin } from "@/db/queries/admin-payments";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PaymentReconciliation } from "@/components/features/admin/payment-reconciliation";

export const metadata = { title: "Payments · NowTutors" };
export const dynamic = "force-dynamic";

/**
 * `/admin/payments` — PayPal reconciliation (SPEC §6, §7.6).
 *
 * Look up one payment by PayPal **order id or capture id** and see exactly what
 * the system did with it: the payments row, the ledger rows referencing it, the
 * booking when it is a direct-pay, and the raw payload. This is the view built
 * specifically to debug the one live transaction that cannot be run from Port
 * Harcourt, so it shows everything rather than a summary.
 *
 * **Read-only in this pass.** Reversing credits on a refund is an admin action
 * with its own design pass (§18 item 4) and is deliberately not built here.
 *
 * `requireRole('admin')` is the first statement, independently of the layout
 * guard (SPEC §5 Layer 2).
 */
export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { user } = await requireRole("admin");

  const { ref } = await searchParams;
  const reference = ref?.trim() ?? "";

  const [payment, [me]] = await Promise.all([
    reference ? findPaymentForAdmin(reference) : Promise.resolve(null),
    db
      .select({ timezone: profiles.timezone })
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .limit(1),
  ]);

  const timeZone = me?.timezone ?? "UTC";

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-8">
      <div>
        <h1 className="text-h1 font-bold text-gray-700">Payments</h1>
        <p className="mt-1 text-body text-gray-500">
          Reconcile a PayPal transaction. Read-only.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Look up a payment</CardTitle>
        </CardHeader>
        <CardContent>
          {/* GET so the lookup is linkable and shareable with a developer. */}
          <form method="GET" className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <Label htmlFor="ref">PayPal order id or capture id</Label>
              <Input
                id="ref"
                name="ref"
                defaultValue={reference}
                placeholder="5O190127TN364715T"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <Button type="submit">Look up</Button>
          </form>
          <p className="mt-2 text-small text-gray-500">
            Matched exactly against <code>provider_order_id</code> and{" "}
            <code>provider_capture_id</code>. A refund event carries only the
            capture id, so either works.
          </p>
        </CardContent>
      </Card>

      {reference && !payment && (
        <Alert variant="warning" title="No payment found">
          Nothing matches <code>{reference}</code> on either{" "}
          <code>provider_order_id</code> or <code>provider_capture_id</code>. If
          PayPal shows a transaction for this id, no <code>payments</code> row was
          ever created for it — which is itself the finding.
        </Alert>
      )}

      {payment && <PaymentReconciliation payment={payment} timeZone={timeZone} />}

      {!reference && (
        <Alert variant="info">
          Enter a PayPal order id or capture id above to see what the system
          recorded for it.
        </Alert>
      )}
    </div>
  );
}
