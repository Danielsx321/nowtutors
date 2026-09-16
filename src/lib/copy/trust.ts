/**
 * Trust copy for student booking surfaces (SPEC §10.3, "Trust line").
 *
 * The guarantee is a promise to students, so it only renders when the client
 * has agreed to it. Noora confirmed the promise and this wording on 2026-09-16
 * (DECISIONS, "Design overhaul: Noora's answers"). It matches the force-cancel
 * refund rule (§7.6): a tutor no-show refunds the held credits. Change the
 * wording here and nowhere else.
 */
export const TRUST_GUARANTEE_CONFIRMED = true;

export const TRUST_GUARANTEE = "If your tutor doesn't show, your credits come back.";

/** Ships regardless of the guarantee: it is a fact, not a promise. */
export const TRUST_PAYMENT = "Secure payment via PayPal";
