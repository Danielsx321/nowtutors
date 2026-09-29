"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/guards";
import { getWithdrawalSettings } from "@/lib/settings";
import { getPayoutEmailFor, withdrawalRunner } from "@/db/queries/withdrawals";
import { queueEmails } from "@/lib/email";
import { getRecipient } from "@/lib/email/recipient";
import {
  requestWithdrawal as requestWithdrawalCore,
  withdrawalRefusalMessage,
} from "@/lib/withdrawals/withdrawals";

export type RequestWithdrawalResult =
  | { error: string }
  | { ok: true; amountCredits: number; amountUsd: string };

/**
 * A tutor requests a withdrawal of their whole available balance (SPEC §7.11,
 * `/tutor/withdrawals`; Phase 8 Part 2).
 *
 * `requireRole('tutor')` is the first statement and enforces approval (§5
 * Layer 2). **The client sends nothing**: the amount is the wallet balance read
 * under lock, the USD figure comes from `payout_usd_per_credit`, and the
 * destination is the tutor's saved PayPal email. The $30 minimum is enforced
 * here, server-side, never only by the disabled button (§18 item 10).
 */
export async function requestWithdrawal(): Promise<RequestWithdrawalResult> {
  const { user } = await requireRole("tutor");
  const settings = await getWithdrawalSettings();

  const res = await requestWithdrawalCore(withdrawalRunner, {
    tutorId: user.id,
    settings,
  });
  if (!res.ok) return { error: withdrawalRefusalMessage(res.reason, settings) };

  // The receipt and the admin alert (SPEC §11), after the response. The
  // lookups run then too: the destination is not in the result on purpose
  // (the request snapshots it under lock) and the name is only for the alert.
  const { id: tutorId } = user;
  const { amountCredits, amountUsd } = res.withdrawal;
  queueEmails(async () => {
    const [tutor, destination] = await Promise.all([getRecipient(tutorId), getPayoutEmailFor(tutorId)]);
    // The admin sees the legal name first: it is what PayPal will show.
    const tutorName = tutor?.fullName ?? tutor?.displayName ?? tutor?.email ?? "A tutor";
    return [
      { type: "withdrawal-requested", to: { userId: tutorId }, props: { amountCredits, amountUsd, destination } },
      { type: "admin-new-withdrawal", to: { admins: true }, props: { tutorName, amountCredits, amountUsd } },
    ];
  });

  revalidatePath("/tutor/withdrawals");
  revalidatePath("/tutor/earnings");
  revalidatePath("/admin/withdrawals");
  return {
    ok: true,
    amountCredits: res.withdrawal.amountCredits,
    amountUsd: res.withdrawal.amountUsd,
  };
}
