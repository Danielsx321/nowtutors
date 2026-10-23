/**
 * Security headers for every response (SPEC §2, DECISIONS 2026-10-22 "Security
 * headers"). Wired into `next.config.ts` `headers()` as `source: "/(.*)"`.
 *
 * Everything is enforced from day one except the Content-Security-Policy, which
 * ships as `Content-Security-Policy-Report-Only` for a week: a wrong CSP would
 * block PayPal checkout or live video, so violations are watched in the browser
 * console first and a one-line change (`CSP_HEADER`) enforces it afterwards.
 *
 * The CSP is built from ONE host list, `CSP_HOSTS`, so adding an integration is
 * one edit in one place. Each host was taken from the code, not from memory:
 *   - PayPal: the JS SDK script `www.paypal.com/sdk/js` (`buy-credits.tsx`), its
 *     checkout frames (`www.paypal.com`, `www.sandbox.paypal.com`), assets on
 *     `*.paypalobjects.com`. Server-side Orders calls (`api-m.*`) never run in
 *     the browser and need no entry.
 *   - Agora: `agora-rtc-sdk-ng` opens HTTPS and WebSocket connections to many
 *     `*.agora.io` and `*.sd-rtn.com` hosts (gateway, edge, stats, log, proxy),
 *     and starts workers from `blob:` URLs.
 *   - LessonSpace: the classroom iframe loads the launch call's `client_url`
 *     (`app.thelessonspace.com` in the fixtures). The launch call itself is
 *     server-side.
 *   - Supabase: REST, Auth and Storage over HTTPS, Realtime over WSS, signed
 *     Storage links rendered as plain `<img>` (attachment previews).
 *   - Sentry: the browser SDK posts to `*.ingest.*.sentry.io` when a DSN is set.
 *   - Google OAuth: Supabase's `/auth/v1/authorize` (a top-level navigation,
 *     which CSP does not govern) sends the browser on to `accounts.google.com`.
 *     It is listed under `form-action` so a future form-posted sign-in still works.
 *   - Cloudflare Turnstile (security PR D): its script and challenge frame on
 *     `challenges.cloudflare.com`. Cloudflare's CSP guidance names script-src
 *     and frame-src; `connect-src` is added too (Security D, 2026-10-23) in case
 *     the loader fetches from the page itself, since an unlisted host there
 *     would only show once the CSP is enforced.
 */

/** Header name for the CSP. Flip to "Content-Security-Policy" to enforce. */
export const CSP_HEADER = "Content-Security-Policy-Report-Only" as const;

/** Every third-party origin the browser talks to, grouped by integration. */
export const CSP_HOSTS = {
  paypal: {
    script: ["https://www.paypal.com", "https://*.paypal.com", "https://*.paypalobjects.com"],
    connect: ["https://*.paypal.com", "https://*.paypalobjects.com"],
    img: ["https://*.paypal.com", "https://*.paypalobjects.com"],
    frame: ["https://*.paypal.com"],
    form: ["https://*.paypal.com"],
  },
  agora: {
    connect: [
      "https://*.agora.io",
      "wss://*.agora.io",
      "https://*.sd-rtn.com",
      "wss://*.sd-rtn.com",
    ],
  },
  lessonspace: {
    connect: ["https://*.thelessonspace.com"],
    frame: ["https://*.thelessonspace.com"],
  },
  supabase: {
    connect: ["https://*.supabase.co", "wss://*.supabase.co"],
    img: ["https://*.supabase.co"],
    media: ["https://*.supabase.co"],
  },
  sentry: {
    connect: ["https://*.sentry.io"],
  },
  google: {
    form: ["https://accounts.google.com"],
  },
  turnstile: {
    script: ["https://challenges.cloudflare.com"],
    connect: ["https://challenges.cloudflare.com"],
    frame: ["https://challenges.cloudflare.com"],
  },
} as const;

type Kind = "script" | "connect" | "img" | "frame" | "form" | "media";

function hostsFor(kind: Kind): string[] {
  const out: string[] = [];
  for (const group of Object.values(CSP_HOSTS)) {
    const list = (group as Partial<Record<Kind, readonly string[]>>)[kind];
    if (list) for (const h of list) if (!out.includes(h)) out.push(h);
  }
  return out;
}

export interface SecurityHeaderOptions {
  /** `next dev` needs `'unsafe-eval'` for React Refresh; never in a build. */
  dev?: boolean;
}

/**
 * The CSP string. `'unsafe-inline'` on scripts is there while the policy is
 * Report-Only (Next's inline bootstrap scripts); replacing it with nonces is a
 * follow-up before or with enforcement.
 */
export function buildCsp({ dev = false }: SecurityHeaderOptions = {}): string {
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    [
      "script-src",
      ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : []), ...hostsFor("script")],
    ],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["connect-src", ["'self'", ...hostsFor("connect")]],
    ["img-src", ["'self'", "data:", "blob:", ...hostsFor("img")]],
    ["font-src", ["'self'", "data:"]],
    ["media-src", ["'self'", "blob:", ...hostsFor("media")]],
    ["worker-src", ["'self'", "blob:"]],
    ["frame-src", hostsFor("frame")],
    ["frame-ancestors", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'", ...hostsFor("form")]],
    ["object-src", ["'none'"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

/**
 * Payment is allowed for this origin and PayPal's frames; the features nothing
 * here uses are denied.
 *
 * Camera, microphone, display-capture and fullscreen are deliberately NOT in
 * the header, which leaves them at the browser default: this origin, plus any
 * frame the page delegates to with `allow=` (DECISIONS 2026-10-22). A header
 * value of `camera=(self)` would stop that delegation, and the LessonSpace
 * classroom iframe (`classroom-frame.tsx`, `allow="camera; microphone;
 * display-capture; fullscreen"`) would lose its camera on every scheduled
 * session. Instant sessions and broadcasts run on this origin and keep working
 * either way. Tighten to `camera=(self "<classroom origin>")` once the real
 * `client_url` origin is confirmed from a live launch.
 */
export const PERMISSIONS_POLICY = [
  'payment=(self "https://www.paypal.com" "https://www.sandbox.paypal.com")',
  "geolocation=()",
  "usb=()",
  "serial=()",
  "hid=()",
  "bluetooth=()",
  "midi=()",
  "magnetometer=()",
  "gyroscope=()",
  "accelerometer=()",
  "browsing-topics=()",
].join(", ");

export interface HeaderEntry {
  key: string;
  value: string;
}

export function buildSecurityHeaders(options: SecurityHeaderOptions = {}): HeaderEntry[] {
  return [
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
    { key: CSP_HEADER, value: buildCsp(options) },
  ];
}
