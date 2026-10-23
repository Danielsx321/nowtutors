/**
 * Cloudflare Turnstile on the password forms (Security D, 2026-10-23; SPEC §2,
 * §2.1, §7.1). Supabase Auth checks the token itself once "Bot and Abuse
 * Protection" is on: the app only carries the token from the widget to
 * `signInWithPassword`, `signUp` and `resetPasswordForEmail` as
 * `options.captchaToken`. The secret lives in Supabase Auth settings only.
 *
 * Shared by the browser (forms, schemas) and the server (actions), so nothing
 * server-only here. `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is inlined at build time
 * on both sides; unset (local dev, CI) means no widget and no token required.
 */

export const TURNSTILE_SITE_KEY: string = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

/** True when a site key is configured, so every password form must send a token. */
export const CAPTCHA_REQUIRED: boolean = TURNSTILE_SITE_KEY.trim().length > 0;

/** The one thing a person is told when the check is missing, expired or refused. */
export const CAPTCHA_MESSAGE = "Please complete the check and try again.";

/**
 * True for Supabase's captcha refusal. GoTrue answers with error code
 * `captcha_failed` ("captcha protection: request disallowed (...)"); older
 * versions only carry the message, so both are checked.
 */
export function isCaptchaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === "captcha_failed") return true;
  return typeof message === "string" && /captcha/i.test(message);
}
