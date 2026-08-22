/**
 * `PayPalConfigError` and its type guard, deliberately in a module that does
 * NOT declare `server-only`.
 *
 * `lib/paypal/client.ts` — where this class used to live and from which it is
 * still re-exported, so every existing import keeps working — carries
 * `server-only`, which Next's bundler resolves but which is not an installed
 * package (docs/DECISIONS.md, Phase 5 Part 1). A unit test therefore cannot
 * import `client.ts` at all, and the route-adapter config boundary (§7.6, Part 2)
 * has to be assertable: "a missing credential yields 503, not a throw" is the
 * kind of thing that is only ever discovered in production otherwise.
 */

/** Raised when the server is missing PayPal credentials. */
export class PayPalConfigError extends Error {
  readonly code = "paypal_not_configured" as const;
  constructor(missing: string) {
    super(`PayPal is not configured: ${missing} is unset.`);
    this.name = "PayPalConfigError";
  }
}

/**
 * True for a {@link PayPalConfigError}. Structural rather than `instanceof` so
 * it still holds for an error that crossed a module-instance boundary (the class
 * is re-exported from `client.ts`), and so the check itself is testable.
 */
export function isPayPalConfigError(err: unknown): err is PayPalConfigError {
  if (err instanceof PayPalConfigError) return true;
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "paypal_not_configured"
  );
}
