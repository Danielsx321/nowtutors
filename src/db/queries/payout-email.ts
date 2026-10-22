import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, tutorPayoutDetails } from "@/db/schema";
import {
  payoutEmailAuditRow,
  payoutEmailChanged,
} from "@/lib/withdrawals/payout-email-audit";

/**
 * Save a tutor's PayPal payout email and, when it really changes, write the
 * `payout_email_changed` audit row in the same transaction (Security C,
 * 2026-10-22). The stored row is locked first, so two saves at once log the
 * change each actually made rather than both seeing the same "before".
 *
 * Returns the address it replaced (null when there was none) and whether the
 * write changed anything, so the action knows whether to send the notice.
 */
export async function savePayoutEmail(p: {
  tutorId: string;
  email: string;
  ip: string | null;
}): Promise<{ changed: boolean; previous: string | null }> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ paypalEmail: tutorPayoutDetails.paypalEmail })
      .from(tutorPayoutDetails)
      .where(eq(tutorPayoutDetails.tutorId, p.tutorId))
      .for("update");
    const previous = before?.paypalEmail ?? null;
    const changed = payoutEmailChanged(previous, p.email);

    await tx
      .insert(tutorPayoutDetails)
      .values({ tutorId: p.tutorId, payoutMethod: "paypal", paypalEmail: p.email })
      .onConflictDoUpdate({
        target: tutorPayoutDetails.tutorId,
        set: { paypalEmail: p.email },
      });

    if (changed) {
      await tx
        .insert(auditLog)
        .values(payoutEmailAuditRow({ tutorId: p.tutorId, from: previous, to: p.email, ip: p.ip }));
    }
    return { changed, previous };
  });
}
