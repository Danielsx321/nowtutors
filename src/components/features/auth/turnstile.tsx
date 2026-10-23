"use client";

import * as React from "react";
import Script from "next/script";
import { TURNSTILE_SITE_KEY } from "@/lib/auth/captcha";

/**
 * Cloudflare Turnstile, rendered explicitly (Security D, 2026-10-23; SPEC §2).
 * Loaded from its script tag, not an npm package. `next/script` loads the
 * file once per page and dedupes it across every mount (login, signup, the
 * reset request and change password can all mount it).
 *
 * The token goes to the form two ways: `onToken` (react-hook-form forms call
 * `setValue("captchaToken", …)`) and a hidden `captchaToken` input for a plain
 * form post. Tokens are single-use, so the form calls `reset()` after every
 * submit. Expired, timed-out and failed checks clear the token, which keeps
 * the submit button honestly disabled.
 *
 * No site key (local dev, CI): renders nothing and never calls `onToken`.
 */

export const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** Managed widget, normal size: 300×65. Reserved so nothing jumps on load. */
const WIDGET_HEIGHT_PX = 65;

type TurnstileRenderOptions = {
  sitekey: string;
  theme?: "light" | "dark" | "auto";
  size?: "normal" | "flexible" | "compact";
  action?: string;
  appearance?: "always" | "execute" | "interaction-only";
  "response-field"?: boolean;
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "timeout-callback"?: () => void;
  "error-callback"?: (code?: string) => boolean | void;
};

export type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string | undefined;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export type TurnstileHandle = {
  /** Fetch a fresh token (after a submit, whether it worked or not). */
  reset: () => void;
};

export function Turnstile({
  onToken,
  action,
  siteKey = TURNSTILE_SITE_KEY,
  ref,
}: {
  /** The current token, or null when there is none (expired, failed, reset). */
  onToken: (token: string | null) => void;
  /** Shown in Cloudflare's analytics, e.g. "login". */
  action?: string;
  siteKey?: string;
  ref?: React.Ref<TurnstileHandle>;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const widgetId = React.useRef<string | undefined>(undefined);
  const [token, setToken] = React.useState("");
  const [failed, setFailed] = React.useState(false);
  // Read through a ref so a new callback each render never re-renders the widget.
  const onTokenRef = React.useRef(onToken);
  React.useEffect(() => {
    onTokenRef.current = onToken;
  });

  const publish = React.useCallback((value: string | null) => {
    setToken(value ?? "");
    onTokenRef.current(value);
  }, []);

  const renderWidget = React.useCallback(() => {
    const api = window.turnstile;
    const el = containerRef.current;
    if (!api || !el || !siteKey || widgetId.current !== undefined) return;
    widgetId.current = api.render(el, {
      sitekey: siteKey,
      theme: "light", // the site has no dark theme
      size: "flexible",
      action,
      "response-field": false, // the hidden captchaToken input below is ours
      callback: (t) => {
        setFailed(false);
        publish(t);
      },
      "expired-callback": () => publish(null), // Turnstile refreshes it itself
      "timeout-callback": () => publish(null),
      "error-callback": () => {
        setFailed(true);
        publish(null);
      },
    });
  }, [siteKey, action, publish]);

  // The script may already be on the page (another form, an earlier visit to
  // this route), in which case `onReady` is not the only way in.
  React.useEffect(() => {
    if (!siteKey) return;
    renderWidget();
    return () => {
      if (widgetId.current !== undefined) window.turnstile?.remove(widgetId.current);
      widgetId.current = undefined;
    };
  }, [siteKey, renderWidget]);

  React.useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        if (!siteKey) return;
        publish(null);
        if (widgetId.current !== undefined) window.turnstile?.reset(widgetId.current);
      },
    }),
    [siteKey, publish],
  );

  if (!siteKey) return null;

  return (
    <div className="space-y-1">
      <Script src={TURNSTILE_SCRIPT_SRC} strategy="afterInteractive" onReady={renderWidget} />
      <div
        ref={containerRef}
        role="group"
        aria-label="Security check"
        data-testid="turnstile"
        className="w-full"
        style={{ minHeight: WIDGET_HEIGHT_PX }}
      />
      <input type="hidden" name="captchaToken" value={token} readOnly />
      <p role="status" aria-live="polite" className="text-small text-danger">
        {failed ? "The security check didn't load. Check your connection, or refresh the page." : null}
      </p>
    </div>
  );
}
