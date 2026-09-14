"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { tutorPayoutDetails } from "@/db/schema";
import { requireRole } from "@/lib/auth/guards";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid PayPal email."),
});

export type PayoutEmailResult = { error: string } | { ok: true };

/**
 * Save the tutor's PayPal payout email (SPEC §6 `/tutor/settings`, §7.11).
 *
 * Approval is NOT required: a tutor waiting on approval may as well have this
 * ready. It authorizes only the caller's own row, and the id comes from the
 * guard, never the client. Not audited: it is the tutor's own data, and every
 * withdrawal snapshots the address it was paid to (`payout_destination`), so a
 * later change cannot rewrite where an earlier payout went.
 */
export async function updatePayoutEmail(input: {
  email: string;
}): Promise<PayoutEmailResult> {
  const { user } = await requireRole("tutor", { requireApproval: false });
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid email." };
  }

  await db
    .insert(tutorPayoutDetails)
    .values({
      tutorId: user.id,
      payoutMethod: "paypal",
      paypalEmail: parsed.data.email,
    })
    .onConflictDoUpdate({
      target: tutorPayoutDetails.tutorId,
      set: { paypalEmail: parsed.data.email },
    });

  revalidatePath("/tutor/settings");
  revalidatePath("/tutor/withdrawals");
  return { ok: true };
}
