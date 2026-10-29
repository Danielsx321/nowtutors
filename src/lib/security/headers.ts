/**
 * Security headers for every response (SPEC §2, DECISIONS 2026-10-22 "Security
 * headers"). Wired into `next.config.ts` `headers()` as `source: "/(.*)"`.
 *
 * Everything is enforced. The Content-Security-Policy shipped Report-Only from
 * 2026-10-23 to 2026-10-29 so a wrong host could not block PayPal checkout or
 * live video. The production console showed one message, an eval probe from
 * inside Cloudflare Turnstile's frame; Cloudflare's CSP guidance needs only
 * script-src and frame-src, so `'unsafe-eval'` stays out. Enforced from
 * 2026-10-29 (DECISIONS 2026-10-29).
 * When a Sentry DSN is set, violations are reported to Sentry's security
 * endpoint (`report-uri`), so a blocked host shows up there, not only in one
 * visitor's console.
 *
 * The CSP is built from ONE host list, `CSP_HOSTS`, so adding an integration is
 * one edit in one place. Each host was taken from the code, not from memory:
 *   - PayPal: the JS SDK script `www.paypal.com/sdk/js` (`buy-credits.tsx`), its
 *     checkout frames (`www.paypal.com`, `www.sandbox.paypal.com`), assets on
 *     `*.paypalobjects.com`. Server-side Orders calls (`api-m.*`) never run in
 *     the browser and need no entry. Since enforcement the list follows
 *     PayPal's own CSP guidance (developer.paypal.com/sdk/js/best-practices):
 *     `*.venmo.com` too, because the SDK call does not disable funding sources
 *     and US buyers can get a Venmo button, and the same hosts in `style-src`.
 *   - Agora: `agora-rtc-sdk-ng` opens HTTPS and WebSocket connections to many
 *     `*.agora.io` and `*.sd-rtn.com` hosts (gateway, edge, stats, log, proxy),
 *     and starts workers from `blob:` URLs.
 *   - LessonSpace: the classroom iframe loads the launch call's `client_url`,
 *     which LessonSpace's launch-endpoint docs give as `https://go.room.sh/...`
 *     ("a room.sh link rather than a Lessonspace one"), so `*.room.sh` is in
 *     `frame-src` next to `*.thelessonspace.com`. Found 2026-10-29 before
 *     enforcing: no scheduled classroom ran during the Report-Only week, so the
 *     console never showed it. The launch call itself is server-side.
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

/** Header name for the CSP. "Content-Security-Policy-Report-Only" to watch without blocking. */
export const CSP_HEADER = "Content-Security-Policy" as const;

/** Every third-party origin the browser talks to, grouped by integration. */
export const CSP_HOSTS = {
  paypal: {
    script: [
      "https://www.paypal.com",
      "https://*.paypal.com",
      "https://*.paypalobjects.com",
      "https://*.venmo.com",
    ],
    style: ["https://*.paypal.com", "https://*.paypalobjects.com", "https://*.venmo.com"],
    connect: ["https://*.paypal.com", "https://*.paypalobjects.com", "https://*.venmo.com"],
    img: ["https://*.paypal.com", "https://*.paypalobjects.com", "https://*.venmo.com"],
    frame: ["https://*.paypal.com", "https://*.paypalobjects.com", "https://*.venmo.com"],
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
    frame: ["https://*.thelessonspace.com", "https://*.room.sh"],
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

type Kind = "script" | "style" | "connect" | "img" | "frame" | "form" | "media";

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
  /** Where the browser posts violation reports; see `sentryCspReportUri`. */
  reportUri?: string;
}

/**
 * Sentry's CSP report endpoint for a DSN, or undefined without one (local dev,
 * previews). DSN `https://<key>@o1.ingest.de.sentry.io/2` becomes
 * `https://o1.ingest.de.sentry.io/api/2/security/?sentry_key=<key>`. Report
 * posts are not governed by `connect-src`.
 */
export function sentryCspReportUri(dsn: string | undefined): string | undefined {
  if (!dsn) return undefined;
  try {
    const url = new URL(dsn);
    const project = url.pathname.replace(/^\/+|\/+$/g, "");
    if (!url.username || !project) return undefined;
    return `${url.protocol}//${url.host}/api/${project}/security/?sentry_key=${url.username}`;
  } catch {
    return undefined;
  }
}

/**
 * The CSP string. `'unsafe-inline'` stays on scripts and styles: Next's inline
 * bootstrap scripts need it unless every response carries a fresh nonce, and a
 * nonce makes every page dynamic (no static or cached HTML), which costs more
 * than it buys on a site with no user-authored HTML. The policy still blocks
 * every script, frame, connection and form target outside `CSP_HOSTS`.
 */
export function buildCsp({ dev = false, reportUri }: SecurityHeaderOptions = {}): string {
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    [
      "script-src",
      ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : []), ...hostsFor("script")],
    ],
    ["style-src", ["'self'", "'unsafe-inline'", ...hostsFor("style")]],
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
    ...(reportUri ? ([["report-uri", [reportUri]]] as [string, string[]][]) : []),
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
