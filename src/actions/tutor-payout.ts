"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import { savePayoutEmail } from "@/db/queries/payout-email";
import { queueEmail } from "@/lib/email";
import { getClientIp } from "@/lib/security/client-ip";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid PayPal email."),
});

export type PayoutEmailResult = { error: string } | { ok: true };

/**
 * Save the tutor's PayPal payout email (SPEC §6 `/tutor/settings`, §7.11).
 *
 * Approval is NOT required: a tutor waiting on approval may as well have this
 * ready. It authorizes only the caller's own row, and the id comes from the
 * guard, never the client. Every withdrawal snapshots the address it was paid
 * to (`payout_destination`), so a later change cannot rewrite where an earlier
 * payout went.
 *
 * Audited since Security C (2026-10-22): the payout address is where money
 * goes, so a real change writes `payout_email_changed` (both addresses masked)
 * in the same transaction, and the tutor gets a `payout-email-changed` notice
 * at their account email, not the new PayPal one. Someone who took over a
 * signed-in session and pointed payouts at themselves is then seen by the
 * owner and by an admin. Saving the same address again changes nothing and
 * logs nothing.
 */
export async function updatePayoutEmail(input: {
  email: string;
}): Promise<PayoutEmailResult> {
  const { user } = await requireRole("tutor", { requireApproval: false });
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid email." };
  }

  const { changed, previous } = await savePayoutEmail({
    tutorId: user.id,
    email: parsed.data.email,
    ip: await getClientIp(),
  });
  if (changed && previous) {
    queueEmail({
      type: "payout-email-changed",
      to: { userId: user.id },
      props: { from: previous, to: parsed.data.email, changedAt: new Date().toISOString() },
    });
  }

  revalidatePath("/tutor/settings");
  revalidatePath("/tutor/withdrawals");
  return { ok: true };
}
