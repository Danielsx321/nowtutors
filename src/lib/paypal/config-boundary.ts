import { isPayPalConfigError } from "./config-error";

/**
 * The route-adapter boundary that stops a PayPal misconfiguration surfacing as
 * an uncaught 500 (SPEC §7.6, Phase 5 Part 2).
 *
 * A deploy missing `PAYPAL_CLIENT_ID` made `verifySignature` throw straight out
 * of the webhook route and reach the client as a 500 with a stack trace
 * (observed in production logs, 2026-08-22). A missing credential is the
 * *server's* fault and is fixed by setting the variable — the delivery should be
 * retried afterwards, not permanently discarded — which is exactly the reasoning
 * behind the existing unset-`PAYPAL_WEBHOOK_ID` 503 (docs/DECISIONS.md). So it
 * gets the same answer: 503.
 *
 * The response body is deliberately generic. `PayPalConfigError.message` names
 * the missing variable, which is useful in a log and is an information leak in a
 * response, so the name goes to the server log and never to the caller.
 *
 * Pure and `server-only`-free so the guarantee is unit-testable: the routes it
 * protects cannot themselves be imported by a test.
 */

/** The generic 503 every PayPal route returns when credentials are missing. */
export const PAYPAL_UNAVAILABLE_STATUS = 503;
export const PAYPAL_UNAVAILABLE_BODY = {
  error: "Payments aren't available right now.",
} as const;

/**
 * Run a route handler, converting a `PayPalConfigError` into `onUnavailable()`
 * (a 503) and logging the missing-key detail server-side. Anything else is
 * rethrown untouched — this narrows exactly one failure mode and hides nothing
 * else.
 */
export async function withPayPalConfigBoundary<T>(
  route: string,
  run: () => Promise<T>,
  onUnavailable: () => T,
  log: (message: string) => void = (m) => console.error(m),
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (isPayPalConfigError(err)) {
      // Server-side only: this string names the unset variable.
      log(`[paypal] ${route} unavailable — ${(err as Error).message}`);
      return onUnavailable();
    }
    throw err;
  }
}
