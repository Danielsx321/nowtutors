/**
 * The only post-auth redirect target the app accepts (SPEC §5, §6; Security C,
 * 2026-10-22). Used by the auth actions and `/auth/callback`, so the two can
 * never disagree about what is "in-app".
 *
 * Accepts a path that starts with exactly one `/`. Refuses, falling back to
 * the caller's default:
 *   - anything not starting with `/` (an absolute URL, `javascript:`, a bare host);
 *   - `//host` (protocol-relative: the browser leaves the site);
 *   - any backslash, raw or as `%5C`: browsers read `/\evil.com` as `//evil.com`;
 *   - any control character, raw or percent-encoded (`%00`-`%1F`, `%7F`): a tab
 *     or newline inside `/\t/evil.com` is stripped by the URL parser and leaves
 *     `//evil.com` behind.
 *
 * Pure and dependency-free: it runs in a route handler, a server action and a
 * unit test alike. Not in `actions/auth.ts`, because a "use server" file may
 * only export async functions.
 */
export function safeNext(next: string | undefined | null): string | null {
  if (!next) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  if (next.includes("\\") || /%5c/i.test(next)) return null;
  if (/[\u0000-\u001f\u007f]/.test(next)) return null;
  if (/%(?:[01][0-9a-f]|7f)/i.test(next)) return null;
  return next;
}
