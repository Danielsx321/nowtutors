import { describe, expect, it } from "vitest";
import {
  canOpenPaymentHold,
  MAX_OPEN_PAYMENT_HOLDS,
  PAYMENT_HOLD_LIMIT_MESSAGE,
} from "@/lib/bookings/payment-holds";

/** R3 (launch fixes, 2026-09-26): at most two unpaid holds per student. */
describe("payment holds cap", () => {
  it("allows the first and second hold, refuses the third", () => {
    expect(MAX_OPEN_PAYMENT_HOLDS).toBe(2);
    expect(canOpenPaymentHold(0)).toBe(true);
    expect(canOpenPaymentHold(1)).toBe(true);
    expect(canOpenPaymentHold(2)).toBe(false);
    expect(canOpenPaymentHold(5)).toBe(false);
  });

  it("tells the student the number and what to do", () => {
    expect(PAYMENT_HOLD_LIMIT_MESSAGE).toMatch(/2 bookings waiting for payment/);
    expect(PAYMENT_HOLD_LIMIT_MESSAGE).toMatch(/expire/);
  });
});
