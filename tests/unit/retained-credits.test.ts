import { describe, it, expect } from "vitest";
import {
  retainedCreditMints,
  retainedCreditsDescription,
  walletDescription,
  type RetainedMintPayment,
  type WalletRow,
} from "@/lib/credits/retained-credits";

/**
 * The retained-credit mint, derived at READ time (SPEC §4.4, §7.6).
 *
 * When a direct-pay capture is honoured but the booking can no longer be
 * confirmed, the student keeps the minted credits. That mint's stored
 * description says "Credit purchase" forever — `credit_transactions` is
 * append-only without exception, so nothing goes back to reword it. The wallet
 * works out what to say on every read instead, and this is where that decision
 * is tested: it must catch the retained mint, and must not mislabel either an
 * ordinary credit purchase or a direct-pay that completed normally.
 */

const PURCHASE_PAYMENT = "11111111-1111-4111-8111-111111111111";
const RETAINED_PAYMENT = "22222222-2222-4222-8222-222222222222";
const SETTLED_PAYMENT = "44444444-4444-4444-8444-444444444444";
const LOST_BOOKING = "33333333-3333-4333-8333-333333333333";
const HELD_BOOKING = "55555555-5555-4555-8555-555555555555";

/** A plain credit purchase: bought credits, no booking anywhere in sight. */
const creditPurchase: RetainedMintPayment = {
  id: PURCHASE_PAYMENT,
  purpose: "credit_purchase",
  bookingId: null,
  amountUsd: "39.99",
  currency: "USD",
};

/** Direct-pay whose slot was gone when the capture landed — credits retained. */
const retainedDirectPay: RetainedMintPayment = {
  id: RETAINED_PAYMENT,
  purpose: "booking",
  bookingId: LOST_BOOKING,
  amountUsd: "26.66",
  currency: "USD",
};

/** Direct-pay that settled normally — mint and debit both landed. */
const settledDirectPay: RetainedMintPayment = {
  id: SETTLED_PAYMENT,
  purpose: "booking",
  bookingId: HELD_BOOKING,
  amountUsd: "26.66",
  currency: "USD",
};

function mint(referenceId: string, delta = 20): WalletRow {
  return {
    type: "purchase",
    delta,
    referenceId,
    description: `Credit purchase — ${delta} credits ($26.66 USD)`,
  };
}

describe("retainedCreditMints — which purchases are retained credits", () => {
  it("catches a direct-pay mint whose booking was never debited", async () => {
    const retained = retainedCreditMints(
      [retainedDirectPay],
      new Set<string>(), // no booking_debit anywhere: the confirm failed
    );
    expect(retained.has(RETAINED_PAYMENT)).toBe(true);
    expect(retained.get(RETAINED_PAYMENT)).toEqual({
      amountUsd: "26.66",
      currency: "USD",
    });
  });

  it("does not catch an ordinary credit purchase", async () => {
    // purpose = 'credit_purchase'. These credits were bought and kept on
    // purpose; nothing was lost, and there is no booking to have lost.
    const retained = retainedCreditMints([creditPurchase], new Set<string>());
    expect(retained.size).toBe(0);
  });

  it("does not catch a direct-pay that completed — its debit exists", async () => {
    // The `booking_debit` is the record that the booking confirmed. Present, so
    // the credits were spent on the session the student actually got; labelling
    // this "retained" would tell them they hold credits they do not.
    const retained = retainedCreditMints(
      [settledDirectPay],
      new Set([HELD_BOOKING]),
    );
    expect(retained.size).toBe(0);
  });

  it("separates the three cases when they appear on one page together", async () => {
    const retained = retainedCreditMints(
      [creditPurchase, retainedDirectPay, settledDirectPay],
      new Set([HELD_BOOKING]),
    );
    expect([...retained.keys()]).toEqual([RETAINED_PAYMENT]);
  });

  it("does not catch a booking payment carrying no booking id", async () => {
    // Nothing was ever booked, so nothing was lost — `captured_no_credit`
    // territory, not a retained mint.
    const retained = retainedCreditMints(
      [{ ...retainedDirectPay, bookingId: null }],
      new Set<string>(),
    );
    expect(retained.size).toBe(0);
  });
});

describe("walletDescription — what the student actually reads", () => {
  it("rewords a retained mint as credits they keep, not a session they paid for", async () => {
    const retained = retainedCreditMints([retainedDirectPay], new Set<string>());
    const shown = walletDescription(mint(RETAINED_PAYMENT), retained) ?? "";

    expect(shown).toContain("20 credits");
    expect(shown).toContain("no longer available");
    expect(shown).toMatch(/yours to spend/i);
    // The stored wording would read as a session they bought and cannot find.
    expect(shown).not.toContain("Credit purchase");
  });

  it("counts the credits from the row's own delta, not the payment", async () => {
    const retained = retainedCreditMints([retainedDirectPay], new Set<string>());
    const shown = walletDescription(mint(RETAINED_PAYMENT, 35), retained) ?? "";
    expect(shown).toContain("35 credits");
  });

  it("leaves an ordinary credit purchase exactly as stored", async () => {
    const retained = retainedCreditMints([creditPurchase], new Set<string>());
    const row = mint(PURCHASE_PAYMENT, 30);
    expect(walletDescription(row, retained)).toBe(row.description);
  });

  it("leaves a completed direct-pay mint exactly as stored", async () => {
    const retained = retainedCreditMints(
      [settledDirectPay],
      new Set([HELD_BOOKING]),
    );
    const row = mint(SETTLED_PAYMENT);
    expect(walletDescription(row, retained)).toBe(row.description);
  });

  it("leaves every non-purchase row alone", async () => {
    // A booking_debit references a booking, not a payment; it must never be
    // matched against the retained map by coincidence of id.
    const retained = retainedCreditMints([retainedDirectPay], new Set<string>());
    const debit: WalletRow = {
      type: "booking_debit",
      delta: -20,
      referenceId: RETAINED_PAYMENT,
      description: "Session paid directly (20 credits)",
    };
    expect(walletDescription(debit, retained)).toBe(debit.description);
  });

  it("passes through a null description and a null reference unchanged", async () => {
    const retained = retainedCreditMints([retainedDirectPay], new Set<string>());
    expect(
      walletDescription(
        { type: "purchase", delta: 10, referenceId: null, description: null },
        retained,
      ),
    ).toBeNull();
  });
});

describe("retainedCreditsDescription — the wording itself", () => {
  it("names the credits, the amount charged, and that they are spendable", async () => {
    const text = retainedCreditsDescription(20, "26.66", "USD");
    expect(text).toContain("20 credits");
    expect(text).toContain("$26.66 USD");
    expect(text).toMatch(/yours to spend on a new booking/i);
  });
});
