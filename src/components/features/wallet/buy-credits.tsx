"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Coins } from "lucide-react";
import { cn } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { CreditPackage } from "@/lib/credits/packages";

/**
 * Buy-credits panel (SPEC §7.6, §7.10).
 *
 * Drives the **existing** endpoints and sends an *intent*, never a price:
 * `POST /api/paypal/orders` with `{ purpose: 'credit_purchase', packageId }`,
 * then `POST /api/paypal/orders/[orderId]/capture` after PayPal approval. The
 * package's credits and USD amount are resolved server-side from
 * `platform_settings.credit_packages`; the prices rendered here are display
 * only and are never sent back.
 *
 * Capture has three outcomes and they are deliberately three different messages:
 *  - **200** — credited; refresh so the new balance and ledger row appear.
 *  - **202** — PayPal returned PENDING. Neither success nor failure: the payment
 *    is still open and the webhook (or a retried capture) resolves it, so say
 *    "processing" and do not claim credits have landed (PR #12, item 4).
 *  - **409** — a terminal decline.
 */

interface PayPalButtonsRenderer {
  render(container: HTMLElement): Promise<void>;
  close?(): void;
}

interface PayPalSdk {
  Buttons(config: {
    style?: Record<string, string>;
    createOrder(): Promise<string>;
    onApprove(data: { orderID: string }): Promise<void>;
    onCancel?(): void;
    onError?(err: unknown): void;
  }): PayPalButtonsRenderer;
}

declare global {
  interface Window {
    paypal?: PayPalSdk;
  }
}

type Status =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "credited"; credits: number }
  | { kind: "pending" }
  | { kind: "error"; message: string };

const SDK_ID = "paypal-sdk";

/** Load the PayPal JS SDK once per document. */
function loadPayPalSdk(clientId: string): Promise<PayPalSdk> {
  return new Promise((resolve, reject) => {
    if (window.paypal) return resolve(window.paypal);

    const existing = document.getElementById(SDK_ID) as HTMLScriptElement | null;
    const onLoad = () =>
      window.paypal
        ? resolve(window.paypal)
        : reject(new Error("PayPal SDK loaded without a global."));

    if (existing) {
      existing.addEventListener("load", onLoad, { once: true });
      existing.addEventListener("error", () => reject(new Error("sdk")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = SDK_ID;
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(
      clientId,
    )}&currency=USD&intent=capture&components=buttons`;
    script.async = true;
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", () => reject(new Error("sdk")), { once: true });
    document.body.appendChild(script);
  });
}

async function readError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  const message = (body as { error?: unknown } | null)?.error;
  return typeof message === "string" && message ? message : fallback;
}

export interface BuyCreditsProps {
  packages: CreditPackage[];
  /** `NEXT_PUBLIC_PAYPAL_CLIENT_ID`; null when unset (payments unavailable). */
  paypalClientId: string | null;
}

export function BuyCredits({ packages, paypalClientId }: BuyCreditsProps) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<string>(packages[0]?.id ?? "");
  const [status, setStatus] = React.useState<Status>({ kind: "idle" });
  const [sdkReady, setSdkReady] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  // The selected package id, read at click time rather than captured, so the
  // SDK's long-lived callbacks always see the current selection.
  const selectedRef = React.useRef(selected);
  React.useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const statusRef = React.useRef(status);
  statusRef.current = status;

  React.useEffect(() => {
    if (!paypalClientId) return;
    let cancelled = false;
    loadPayPalSdk(paypalClientId)
      .then(() => !cancelled && setSdkReady(true))
      .catch(
        () =>
          !cancelled &&
          setStatus({
            kind: "error",
            message: "Couldn't load PayPal. Check your connection and refresh.",
          }),
      );
    return () => {
      cancelled = true;
    };
  }, [paypalClientId]);

  // Mount the PayPal buttons once the SDK is ready. Rendered once; the
  // callbacks read the live selection through refs.
  React.useEffect(() => {
    const container = containerRef.current;
    if (!sdkReady || !container || !window.paypal) return;

    let buttons: PayPalButtonsRenderer | null = null;
    container.innerHTML = "";

    buttons = window.paypal.Buttons({
      style: { layout: "vertical", shape: "rect", label: "paypal" },

      async createOrder() {
        setStatus({ kind: "working" });
        // Intent only — no amount. The server resolves credits + price from
        // platform_settings.credit_packages.
        const res = await fetch("/api/paypal/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            purpose: "credit_purchase",
            packageId: selectedRef.current,
          }),
        });
        if (!res.ok) {
          const message = await readError(res, "Couldn't start this payment.");
          setStatus({ kind: "error", message });
          throw new Error(message);
        }
        const body = (await res.json()) as { orderId: string };
        return body.orderId;
      },

      async onApprove(data) {
        setStatus({ kind: "working" });
        const res = await fetch(
          `/api/paypal/orders/${encodeURIComponent(data.orderID)}/capture`,
          { method: "POST" },
        );

        // 202 — PayPal returned PENDING. Not a success and not a failure.
        if (res.status === 202) {
          setStatus({ kind: "pending" });
          router.refresh();
          return;
        }

        if (!res.ok) {
          setStatus({
            kind: "error",
            message: await readError(res, "That payment didn't complete."),
          });
          return;
        }

        const body = (await res.json()) as { credits?: number };
        setStatus({ kind: "credited", credits: body.credits ?? 0 });
        router.refresh();
      },

      onCancel() {
        setStatus({ kind: "idle" });
      },

      onError() {
        // A createOrder rejection already set a specific message; don't stomp it.
        if (statusRef.current.kind !== "error") {
          setStatus({
            kind: "error",
            message: "Something went wrong with PayPal. Please try again.",
          });
        }
      },
    });

    void buttons.render(container).catch(() => {
      setStatus({
        kind: "error",
        message: "Couldn't show the PayPal button. Please refresh.",
      });
    });

    return () => {
      try {
        buttons?.close?.();
      } catch {
        // The SDK throws if it already tore itself down; nothing to do.
      }
    };
  }, [sdkReady, router]);

  if (packages.length === 0) {
    return <Alert variant="info">No credit packages are available right now.</Alert>;
  }

  if (!paypalClientId) {
    return (
      <Alert variant="warning" title="Payments unavailable">
        Buying credits is temporarily unavailable. Please try again later.
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-2 text-body font-medium text-gray-700">
          Choose a package
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {packages.map((pkg) => {
            const isSelected = pkg.id === selected;
            return (
              <label
                key={pkg.id}
                className={cn(
                  "focus-within:focus-ring flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors",
                  isSelected
                    ? "border-purple-500 bg-purple-50"
                    : "border-gray-200 hover:border-gray-300",
                )}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="creditPackage"
                    value={pkg.id}
                    checked={isSelected}
                    onChange={() => setSelected(pkg.id)}
                    className="sr-only"
                  />
                  <Coins className="size-4 text-purple-500" aria-hidden />
                  <span>
                    <span className="block text-body font-medium text-gray-700">
                      {pkg.name}
                    </span>
                    <span className="block text-small text-gray-500">
                      {pkg.credits.toLocaleString()} credits
                    </span>
                  </span>
                </span>
                <span className="text-body font-bold text-gray-700">
                  ${pkg.priceUsd.toFixed(2)}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {status.kind === "credited" && (
        <Alert variant="success" title="Credits added">
          {status.credits > 0
            ? `${status.credits.toLocaleString()} credits are now in your wallet.`
            : "Your payment completed."}
        </Alert>
      )}

      {status.kind === "pending" && (
        <Alert variant="info" title="Payment processing">
          PayPal is still reviewing this payment. Your credits will appear shortly —
          you don&apos;t need to pay again. This page updates once it clears.
        </Alert>
      )}

      {status.kind === "error" && <Alert variant="danger">{status.message}</Alert>}

      <div>
        {!sdkReady && (
          <div className="flex items-center gap-2 text-small text-gray-500">
            <Spinner size="sm" /> Loading PayPal…
          </div>
        )}
        <div ref={containerRef} aria-busy={status.kind === "working"} />
        {status.kind === "working" && (
          <p className="mt-2 flex items-center gap-2 text-small text-gray-500">
            <Spinner size="sm" /> Talking to PayPal…
          </p>
        )}
      </div>

      <noscript>
        <Alert variant="warning">
          Buying credits needs JavaScript enabled.
        </Alert>
      </noscript>
    </div>
  );
}

/** Kept so a future non-SDK fallback has an obvious home. */
export function BuyCreditsUnavailable() {
  return (
    <Button disabled variant="secondary">
      Buy credits
    </Button>
  );
}
