"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/guards";
import { getWithdrawalSettings } from "@/lib/settings";
import { withdrawalRunner } from "@/db/queries/withdrawals";
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

  // TODO(Phase 10): tutor "withdrawal requested" receipt and admin "new
  // withdrawal request" emails (SPEC §11). Resend wires in Phase 10.

  revalidatePath("/tutor/withdrawals");
  revalidatePath("/tutor/earnings");
  revalidatePath("/admin/withdrawals");
  return {
    ok: true,
    amountCredits: res.withdrawal.amountCredits,
    amountUsd: res.withdrawal.amountUsd,
  };
}
