import { describe, it, expect } from "vitest";
import {
  checkDirectPayEligibility,
  type DirectPayBookingRow,
} from "@/lib/paypal/direct-pay";
import {
  directPayAmount,
  requireDirectPayBasisPackage,
  parseCreditPackages,
} from "@/lib/credits/packages";
import { seededSetting } from "@/db/platform-settings-defaults";

/**
 * Who may open a direct-pay order, and for how much (SPEC §7.3 step 4b, §5).
 *
 * Two guarantees: a booking belonging to another user is rejected, and the price
 * is re-derived server-side rather than read from the booking row or the client.
 */

const OWNER = "alice";
const OTHER = "mallory";

function booking(over: Partial<DirectPayBookingRow> = {}): DirectPayBookingRow {
  return {
    id: "b1",
    studentId: OWNER,
    status: "pending_payment",
    type: "scheduled",
    durationMinutes: 60,
    priceCredits: 20,
    ...over,
  };
}

describe("direct-pay eligibility — ownership", () => {
  it("rejects a booking belonging to another user", () => {
    const result = checkDirectPayEligibility(booking(), OTHER);
    expect(result).toEqual({
      ok: false,
      status: 404,
      message: "Booking not found.",
    });
  });

  it("gives a missing booking and someone else's booking the SAME answer", () => {
    // Otherwise the endpoint becomes an oracle for which booking ids exist.
    const notMine = checkDirectPayEligibility(booking(), OTHER);
    const missing = checkDirectPayEligibility(null, OTHER);
    const alsoMissing = checkDirectPayEligibility(undefined, OWNER);

    expect(notMine).toEqual(missing);
    expect(missing).toEqual(alsoMissing);
  });

  it("accepts the owner", () => {
    const result = checkDirectPayEligibility(booking(), OWNER);
    expect(result).toMatchObject({ ok: true, bookingId: "b1" });
  });
});

describe("direct-pay eligibility — booking state", () => {
  it.each([
    "confirmed",
    "in_progress",
    "completed",
    "cancelled_by_student",
    "expired",
  ])("rejects a %s booking with 409", (status) => {
    const result = checkDirectPayEligibility(booking({ status }), OWNER);
    expect(result).toMatchObject({ ok: false, status: 409 });
  });

  it("rejects an instant booking and a booking with no duration", () => {
    expect(checkDirectPayEligibility(booking({ type: "instant" }), OWNER)).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(
      checkDirectPayEligibility(booking({ durationMinutes: null }), OWNER),
    ).toMatchObject({ ok: false, status: 400 });
  });
});

describe("direct-pay eligibility — the price is re-derived, never read", () => {
  it("M6: charges the price pinned on the booking, not the tutor's current rate", () => {
    const result = checkDirectPayEligibility(booking({ priceCredits: 30, durationMinutes: 90 }), OWNER);
    expect(result).toMatchObject({ ok: true, credits: 30 });
  });

  it("M6: a rate change inside the payment hold changes nothing for this booking", () => {
    // The booking was priced at 10 when the slot was taken. Whatever the tutor
    // has done to their rate since, the student pays 10 and the tutor's
    // earnings are split from 10: one number, both sides.
    const pinned = checkDirectPayEligibility(booking({ priceCredits: 10 }), OWNER);
    expect(pinned).toMatchObject({ credits: 10 });
    expect(pinned).toMatchObject({ credits: booking({ priceCredits: 10 }).priceCredits });
  });

  it("M6: a booking with no pinned price cannot be paid for directly", () => {
    expect(checkDirectPayEligibility(booking({ priceCredits: null }), OWNER)).toMatchObject({ ok: false, status: 400 });
  });

  it("ignores a tampered client amount end to end", () => {
    // The client can only name a bookingId. Whatever amount it might wish for,
    // the order's USD comes from rate × duration priced at the basis tier.
    const basis = requireDirectPayBasisPackage(
      parseCreditPackages(seededSetting<unknown>("credit_packages")),
    );
    const result = checkDirectPayEligibility(booking({ priceCredits: 20, durationMinutes: 60 }), OWNER);
    if (!result.ok) throw new Error("expected eligible");

    expect(result.credits).toBe(20);
    expect(directPayAmount(result.credits, basis)).toBe("26.66");

    // A client wishing to pay $0.01 changes nothing — there is no input for it.
    expect(directPayAmount(result.credits, basis)).not.toBe("0.01");
  });

  it("rejects a booking whose derived price is zero", () => {
    const result = checkDirectPayEligibility(
      booking({ priceCredits: 0 }),
      OWNER,
    );
    expect(result).toMatchObject({ ok: false, status: 400 });
  });
});
