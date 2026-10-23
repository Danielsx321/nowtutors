import { maskEmail } from "./mask-email";

/**
 * The audit row for a tutor's PayPal payout email being set or changed
 * (SPEC §4.7, §7.11; Security C, 2026-10-22; DECISIONS). Written in the same
 * transaction as the change by `actions/tutor-payout.ts` (a change) and
 * `actions/onboarding.ts` (the first set, `from: null`).
 *
 * Both addresses are masked (`maskEmail`, "d•••a@gmail.com") because the audit
 * log is read on admin screens; the domain stays whole, which is what tells
 * an admin whether the money moved to a different provider account. The full
 * address lives only in `tutor_payout_details` and in each withdrawal's own
 * `payout_destination` snapshot.
 *
 * Pure, so the unit lane can assert the row without a database.
 */
export const PAYOUT_EMAIL_CHANGED = "payout_email_changed";

export interface PayoutEmailAuditInput {
  tutorId: string;
  /** The stored address before this write, or null on the first set. */
  from: string | null;
  to: string;
  ip: string | null;
}

/** True when the write really changes the address (case-insensitive, trimmed). */
export function payoutEmailChanged(from: string | null | undefined, to: string): boolean {
  return (from ?? "").trim().toLowerCase() !== to.trim().toLowerCase();
}

export function payoutEmailAuditRow(i: PayoutEmailAuditInput) {
  return {
    actorId: i.tutorId,
    action: PAYOUT_EMAIL_CHANGED,
    targetType: "tutor_payout_details",
    targetId: i.tutorId,
    payload: {
      from: i.from ? maskEmail(i.from) : null,
      to: maskEmail(i.to),
      first_set: i.from == null,
    },
    ip: i.ip,
  };
}
