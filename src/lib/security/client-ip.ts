import "server-only";
import { headers } from "next/headers";

/**
 * The visitor's IP for rate-limit keys (SPEC §5; Security C, 2026-10-22).
 *
 * On Vercel, `x-forwarded-for` is set by the edge and its FIRST entry is the
 * client that connected; anything after it was appended by proxies. A client
 * can send its own `x-forwarded-for`, but Vercel overwrites it rather than
 * appending to it, so the first hop is not spoofable there. `x-real-ip` is the
 * fallback some hosts and local proxies set instead.
 *
 * Returns null when neither header is present (a direct local request). The
 * rate limiter then skips the per-IP key rather than putting every such
 * request into one shared "unknown" bucket that could lock everyone out at
 * once; the per-email and per-user keys still apply.
 */
export function clientIpFrom(h: { get(name: string): string | null }): string | null {
  const forwarded = h.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return normalizeIp(first);
  const real = h.get("x-real-ip")?.trim();
  if (real) return normalizeIp(real);
  return null;
}

/** Bounded and lowercased, so a key can never be made huge or case-split. */
function normalizeIp(ip: string): string | null {
  const v = ip.toLowerCase().slice(0, 64);
  return /^[0-9a-f.:[\]]+$/.test(v) ? v : null;
}

/** The current request's client IP, from `next/headers`. */
export async function getClientIp(): Promise<string | null> {
  return clientIpFrom(await headers());
}
