import type { CookieOptionsWithName } from "@supabase/ssr";

/**
 * Options for the Supabase auth cookies, shared by the server client and the
 * middleware (Security C, 2026-10-22). `@supabase/ssr` spreads these over its
 * defaults (path `/`, 400-day max age), so only what is stated here changes.
 *
 * `secure` in production so the session cookie never travels over plain HTTP;
 * off in development, where `http://localhost` would otherwise drop it.
 * `sameSite: "lax"` is the library default, stated so it cannot drift: the
 * Google sign-in and email links arrive as top-level navigations, which lax
 * allows. `httpOnly` stays off: the browser client reads the session.
 */
export const authCookieOptions: CookieOptionsWithName = {
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
};
