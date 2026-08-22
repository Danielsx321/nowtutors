import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { bookings, payments, tutorProfiles } from "@/db/schema";
import {
  authErrorResponse,
  requireApiRole,
  requireApiVerifiedEmail,
} from "@/lib/auth/api-guards";
import { getCreditPackages } from "@/lib/settings";
import {
  directPayAmount,
  requireCreditPackage,
  requireDirectPayBasisPackage,
  toPayPalAmount,
  UnknownCreditPackageError,
} from "@/lib/credits/packages";
import { createPayPalOrder } from "@/lib/paypal/orders";
import { PayPalApiError, PayPalConfigError } from "@/lib/paypal/client";
import { checkDirectPayEligibility } from "@/lib/paypal/direct-pay";
import {
  PAYPAL_UNAVAILABLE_BODY,
  PAYPAL_UNAVAILABLE_STATUS,
  withPayPalConfigBoundary,
} from "@/lib/paypal/config-boundary";

/**
 * `POST /api/paypal/orders` — open a PayPal order (SPEC §7.6). Two purposes:
 *
 *  - `{ purpose: 'credit_purchase', packageId }` — credits and price resolved
 *    from `platform_settings.credit_packages`.
 *  - `{ purpose: 'booking', bookingId }` — direct-pay (Part 2). The booking must
 *    belong to the caller and be `pending_payment`; the price is re-derived from
 *    the tutor's current rate, and the USD amount from the direct-pay basis
 *    package. Direct-pay is buy-then-spend: this order MINTS the credits the
 *    booking costs, and settlement spends them on it.
 *
 * Any other purpose fails the discriminated union and 400s rather than being
 * half-supported.
 *
 * The client sends an *intent*, never a price. No client-supplied amount is read
 * in either branch, so there is nothing to tamper with.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Two purposes, each with its own required field. Anything else — an unknown
// purpose, or a booking id on a credit purchase — fails the union and 400s
// rather than being half-supported. No amount is accepted in either branch.
const bodySchema = z.discriminatedUnion("purpose", [
  z.object({
    purpose: z.literal("credit_purchase"),
    packageId: z.string().trim().min(1).max(64),
  }),
  z.object({
    purpose: z.literal("booking"),
    bookingId: z.string().uuid(),
  }),
]);

const CURRENCY = "USD";

export async function POST(request: Request) {
  // Adapter-level config boundary: a missing credential is a 503, never an
  // uncaught 500. The inner PayPalConfigError branch below still marks the
  // payment row failed first; this is the backstop for every other path.
  return withPayPalConfigBoundary(
    "POST /api/paypal/orders",
    () => createOrder(request),
    () =>
      NextResponse.json(PAYPAL_UNAVAILABLE_BODY, {
        status: PAYPAL_UNAVAILABLE_STATUS,
      }),
  );
}

async function createOrder(request: Request) {
  let user;
  try {
    user = await requireApiRole("student");
    await requireApiVerifiedEmail();
  } catch (err) {
    const res = authErrorResponse(err);
    if (res) return res;
    throw err;
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Pick a credit package to continue." },
      { status: 400 },
    );
  }

  // Resolve the order's amount, credits and (for direct-pay) the booking. Every
  // number here is server-derived; the client sent an intent only.
  let resolved: ResolvedOrder;
  try {
    resolved =
      parsed.data.purpose === "credit_purchase"
        ? await resolveCreditPurchase(parsed.data.packageId)
        : await resolveBookingDirectPay(parsed.data.bookingId, user.id);
  } catch (err) {
    if (err instanceof UnknownCreditPackageError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof BookingOrderError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    // DirectPayBasisError deliberately falls through: a misconfigured basis is a
    // server fault and must surface, never become a wrong charge (SPEC §3.3).
    throw err;
  }

  // The payment row exists before the buyer can approve anything, so a capture
  // or webhook always has something to attribute the money to. `provider_order_id`
  // is NOT NULL and unique, and PayPal's id doesn't exist yet, so the row is
  // stamped with a `pending:` placeholder (no PayPal id can collide with it) and
  // updated once the order comes back.
  const paymentId = crypto.randomUUID();
  await db.insert(payments).values({
    id: paymentId,
    userId: user.id,
    provider: "paypal",
    providerOrderId: `pending:${paymentId}`,
    amountUsd: resolved.amountValue,
    currency: CURRENCY,
    // For direct-pay this is the amount the checkout MINTS and immediately
    // spends on the booking — settlement credits then debits it (§7.6).
    creditsGranted: resolved.credits,
    purpose: resolved.purpose,
    bookingId: resolved.bookingId ?? null,
    status: "created",
  });

  let order;
  try {
    order = await createPayPalOrder({
      amountValue: resolved.amountValue,
      currency: CURRENCY,
      description: resolved.description,
      customId: paymentId,
      invoiceId: paymentId,
    });
  } catch (err) {
    // The order never opened, so nothing can be captured against this row.
    await db
      .update(payments)
      .set({ status: "failed", rawPayload: serialiseError(err) })
      .where(eq(payments.id, paymentId));

    if (err instanceof PayPalConfigError) {
      return NextResponse.json(
        { error: "Payments aren't available right now." },
        { status: 503 },
      );
    }
    if (err instanceof PayPalApiError) {
      return NextResponse.json(
        { error: "PayPal couldn't start this payment. Please try again." },
        { status: 502 },
      );
    }
    throw err;
  }

  await db
    .update(payments)
    .set({ providerOrderId: order.id })
    .where(eq(payments.id, paymentId));

  return NextResponse.json({ orderId: order.id }, { status: 201 });
}

interface ResolvedOrder {
  purpose: "credit_purchase" | "booking";
  /** 2-decimal string. Server-derived; never a client value. */
  amountValue: string;
  credits: number;
  description: string;
  bookingId?: string;
}

/** A booking direct-pay order the caller may not open, with its HTTP status. */
class BookingOrderError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "BookingOrderError";
  }
}

/** Credit purchase: credits and price both come from settings. */
async function resolveCreditPurchase(packageId: string): Promise<ResolvedOrder> {
  const pkg = requireCreditPackage(await getCreditPackages(), packageId);
  return {
    purpose: "credit_purchase",
    amountValue: toPayPalAmount(pkg.priceUsd),
    credits: pkg.credits,
    description: `${pkg.credits} NowTutors credits — ${pkg.name}`,
  };
}

/**
 * Booking direct-pay (SPEC §7.3 step 4b, §7.6). The booking must belong to the
 * caller and still be awaiting payment; the price is **re-derived** from the
 * tutor's current rate and the booking's duration, never read from the booking
 * row and never from the client. USD comes from the direct-pay basis package.
 */
async function resolveBookingDirectPay(
  bookingId: string,
  userId: string,
): Promise<ResolvedOrder> {
  const [row] = await db
    .select({
      id: bookings.id,
      studentId: bookings.studentId,
      status: bookings.status,
      type: bookings.type,
      durationMinutes: bookings.durationMinutes,
      hourlyRateCredits: tutorProfiles.hourlyRateCredits,
    })
    .from(bookings)
    .innerJoin(tutorProfiles, eq(tutorProfiles.userId, bookings.tutorId))
    .where(eq(bookings.id, bookingId))
    .limit(1);

  // Ownership + status + server-side price re-derivation, all in the pure check.
  const eligible = checkDirectPayEligibility(row, userId);
  if (!eligible.ok) throw new BookingOrderError(eligible.status, eligible.message);

  const basis = requireDirectPayBasisPackage(await getCreditPackages());

  return {
    purpose: "booking",
    amountValue: directPayAmount(eligible.credits, basis),
    credits: eligible.credits,
    description: `NowTutors session — ${row.durationMinutes} min (${eligible.credits} credits)`,
    bookingId: eligible.bookingId,
  };
}

/** A JSON-safe record of a failed order attempt, for `/admin/payments` (Part 2). */
function serialiseError(err: unknown): Record<string, unknown> {
  if (err instanceof PayPalApiError) {
    return { error: "paypal_api_error", status: err.status, body: err.body };
  }
  if (err instanceof PayPalConfigError) return { error: err.code };
  return { error: "unexpected", message: err instanceof Error ? err.message : String(err) };
}
