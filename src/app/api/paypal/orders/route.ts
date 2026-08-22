import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { payments } from "@/db/schema";
import {
  authErrorResponse,
  requireApiRole,
  requireApiVerifiedEmail,
} from "@/lib/auth/api-guards";
import { getCreditPackages } from "@/lib/settings";
import {
  requireCreditPackage,
  toPayPalAmount,
  UnknownCreditPackageError,
} from "@/lib/credits/packages";
import { createPayPalOrder } from "@/lib/paypal/orders";
import { PayPalApiError, PayPalConfigError } from "@/lib/paypal/client";

/**
 * `POST /api/paypal/orders` — open a PayPal order for a credit purchase
 * (SPEC §7.6). Booking direct-pay is the other `purpose` in the spec and is
 * **Phase 5 Part 2**; this route accepts `credit_purchase` only, and the schema
 * rejects anything else rather than half-supporting it.
 *
 * The client sends an *intent*, never a price. The amount and the credits both
 * come from `platform_settings.credit_packages`, looked up server-side from the
 * package id — a client-supplied amount is not read, so there is nothing to
 * tamper with.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  purpose: z.literal("credit_purchase"),
  packageId: z.string().trim().min(1).max(64),
});

const CURRENCY = "USD";

export async function POST(request: Request) {
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

  let pkg;
  try {
    pkg = requireCreditPackage(await getCreditPackages(), parsed.data.packageId);
  } catch (err) {
    if (err instanceof UnknownCreditPackageError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
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
    amountUsd: toPayPalAmount(pkg.priceUsd),
    currency: CURRENCY,
    creditsGranted: pkg.credits,
    purpose: "credit_purchase",
    status: "created",
  });

  let order;
  try {
    order = await createPayPalOrder({
      amountValue: toPayPalAmount(pkg.priceUsd),
      currency: CURRENCY,
      description: `${pkg.credits} NowTutors credits — ${pkg.name}`,
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

/** A JSON-safe record of a failed order attempt, for `/admin/payments` (Part 2). */
function serialiseError(err: unknown): Record<string, unknown> {
  if (err instanceof PayPalApiError) {
    return { error: "paypal_api_error", status: err.status, body: err.body };
  }
  if (err instanceof PayPalConfigError) return { error: err.code };
  return { error: "unexpected", message: err instanceof Error ? err.message : String(err) };
}
