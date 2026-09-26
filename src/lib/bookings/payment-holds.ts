/**
 * How many scheduled bookings a student may hold in `pending_payment` at once
 * (launch fix R3, 2026-09-26; docs/review/2026-09-20-pass-3-races.md).
 *
 * Choosing PayPal opens a hold that blocks the slot for 20 minutes with no
 * debit (SPEC §7.3 step 4b). With no cap, one verified account could block a
 * tutor's whole calendar and renew the holds every 20 minutes. Two is enough
 * for a student comparing two times before paying; a third waits for one to
 * be paid or to expire. Pure, so the rule is unit-tested; the count comes
 * from `countOpenPaymentHolds`.
 */
export const MAX_OPEN_PAYMENT_HOLDS = 2;

/** May a student with `openHolds` unpaid holds open another one? */
export function canOpenPaymentHold(openHolds: number): boolean {
  return openHolds < MAX_OPEN_PAYMENT_HOLDS;
}

export const PAYMENT_HOLD_LIMIT_MESSAGE =
  `You already have ${MAX_OPEN_PAYMENT_HOLDS} bookings waiting for payment. Pay for one, or wait for it to expire, before holding another time.`;
