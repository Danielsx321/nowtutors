import { describe, it, expect, vi } from "vitest";
import {
  PAYPAL_UNAVAILABLE_BODY,
  PAYPAL_UNAVAILABLE_STATUS,
  withPayPalConfigBoundary,
} from "@/lib/paypal/config-boundary";
import {
  isPayPalConfigError,
  PayPalConfigError,
} from "@/lib/paypal/config-error";

/**
 * The route-adapter config boundary (SPEC §7.6). A deploy missing
 * `PAYPAL_CLIENT_ID` threw out of `verifySignature` and surfaced as an uncaught
 * 500 with a stack trace. The guarantee asserted here is that such a failure
 * becomes a 503 — retryable once the variable is set, same as the unset
 * `PAYPAL_WEBHOOK_ID` 503 — and that the missing variable's NAME never reaches
 * the response body.
 */

const UNAVAILABLE = () => ({
  status: PAYPAL_UNAVAILABLE_STATUS,
  body: { ...PAYPAL_UNAVAILABLE_BODY },
});

describe("withPayPalConfigBoundary — a config error is a 503, not a throw", () => {
  it("returns 503 instead of propagating PayPalConfigError", async () => {
    const log = vi.fn();
    const result = await withPayPalConfigBoundary(
      "POST /api/webhooks/paypal",
      async () => {
        throw new PayPalConfigError("PAYPAL_CLIENT_ID");
      },
      UNAVAILABLE,
      log,
    );

    expect(result.status).toBe(503);
    expect(result.body).toEqual({ error: "Payments aren't available right now." });
  });

  it("does not leak the missing key name in the response body", async () => {
    const result = await withPayPalConfigBoundary(
      "POST /api/paypal/orders",
      async () => {
        throw new PayPalConfigError("PAYPAL_CLIENT_SECRET");
      },
      UNAVAILABLE,
      vi.fn(),
    );

    const serialised = JSON.stringify(result.body);
    expect(serialised).not.toContain("PAYPAL_CLIENT_SECRET");
    expect(serialised).not.toContain("PAYPAL_CLIENT_ID");
    expect(serialised).not.toContain("unset");
  });

  it("logs the missing key name server-side, where it is useful", async () => {
    const log = vi.fn();
    await withPayPalConfigBoundary(
      "POST /api/webhooks/paypal",
      async () => {
        throw new PayPalConfigError("PAYPAL_CLIENT_ID");
      },
      UNAVAILABLE,
      log,
    );

    expect(log).toHaveBeenCalledTimes(1);
    const logged = String(log.mock.calls[0][0]);
    expect(logged).toContain("PAYPAL_CLIENT_ID");
    expect(logged).toContain("POST /api/webhooks/paypal");
  });

  it("passes a successful result straight through, untouched", async () => {
    const result = await withPayPalConfigBoundary<{
      status: number;
      body: Record<string, unknown>;
    }>(
      "POST /api/paypal/orders",
      async () => ({ status: 201, body: { orderId: "5O190127TN364715T" } }),
      UNAVAILABLE,
      vi.fn(),
    );
    expect(result).toEqual({ status: 201, body: { orderId: "5O190127TN364715T" } });
  });

  it("rethrows anything that is NOT a config error — it narrows one failure mode", async () => {
    const boom = new Error("connection reset");
    await expect(
      withPayPalConfigBoundary(
        "POST /api/paypal/orders",
        async () => {
          throw boom;
        },
        UNAVAILABLE,
        vi.fn(),
      ),
    ).rejects.toBe(boom);
  });
});

describe("isPayPalConfigError", () => {
  it("recognises the class and the structural shape, and nothing else", () => {
    expect(isPayPalConfigError(new PayPalConfigError("PAYPAL_CLIENT_ID"))).toBe(true);
    // Same discriminant across a module-instance boundary.
    expect(isPayPalConfigError({ code: "paypal_not_configured" })).toBe(true);

    expect(isPayPalConfigError(new Error("nope"))).toBe(false);
    expect(isPayPalConfigError({ code: "paypal_api_error" })).toBe(false);
    expect(isPayPalConfigError(null)).toBe(false);
    expect(isPayPalConfigError(undefined)).toBe(false);
    expect(isPayPalConfigError("paypal_not_configured")).toBe(false);
  });
});
