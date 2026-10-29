import { describe, expect, it } from "vitest";
import {
  buildCsp,
  buildSecurityHeaders,
  CSP_HEADER,
  PERMISSIONS_POLICY,
  sentryCspReportUri,
} from "@/lib/security/headers";
import config from "../../next.config";

function headerMap() {
  return Object.fromEntries(buildSecurityHeaders().map((h) => [h.key, h.value]));
}

function directive(csp: string, name: string): string[] {
  const found = csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `));
  expect(found, `CSP has ${name}`).toBeDefined();
  return found!.split(/\s+/).slice(1);
}

describe("buildSecurityHeaders (security PR B, next.config.ts)", () => {
  it("sends every enforced header with the agreed value", () => {
    const h = headerMap();
    expect(h["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains; preload");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Permissions-Policy"]).toBe(PERMISSIONS_POLICY);
  });

  it("enforces the CSP (Report-Only ended 2026-10-29)", () => {
    const h = headerMap();
    expect(CSP_HEADER).toBe("Content-Security-Policy");
    expect(h["Content-Security-Policy"]).toBe(buildCsp());
    expect(h["Content-Security-Policy-Report-Only"]).toBeUndefined();
  });

  it("permissions: payment for self and PayPal, unused features denied", () => {
    expect(PERMISSIONS_POLICY).toContain('payment=(self "https://www.paypal.com"');
    for (const f of ["geolocation", "usb", "serial", "hid", "bluetooth", "midi", "browsing-topics"]) {
      expect(PERMISSIONS_POLICY).toContain(`${f}=()`);
    }
  });

  it("permissions: camera and microphone are not narrowed to self (LessonSpace frame keeps them)", () => {
    // camera=(self) in the header would block the classroom iframe's `allow=camera`.
    for (const f of ["camera", "microphone", "display-capture", "fullscreen"]) {
      expect(PERMISSIONS_POLICY).not.toMatch(new RegExp(`(^|, )${f}=`));
    }
  });
});

describe("buildCsp", () => {
  const csp = buildCsp();

  it("locks framing, base and object down", () => {
    expect(directive(csp, "default-src")).toEqual(["'self'"]);
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(csp, "base-uri")).toEqual(["'self'"]);
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
  });

  it("PayPal: SDK script, checkout frame, images, calls and form posts", () => {
    expect(directive(csp, "script-src")).toEqual(
      expect.arrayContaining(["https://www.paypal.com", "https://*.paypal.com", "https://*.paypalobjects.com"]),
    );
    expect(directive(csp, "frame-src")).toContain("https://*.paypal.com");
    expect(directive(csp, "img-src")).toEqual(
      expect.arrayContaining(["https://*.paypal.com", "https://*.paypalobjects.com"]),
    );
    expect(directive(csp, "connect-src")).toContain("https://*.paypal.com");
    expect(directive(csp, "form-action")).toEqual(["'self'", "https://*.paypal.com", "https://accounts.google.com"]);
  });

  it("PayPal: Venmo and style hosts per PayPal's CSP guidance", () => {
    for (const d of ["script-src", "style-src", "connect-src", "img-src", "frame-src"]) {
      expect(directive(csp, d)).toEqual(
        expect.arrayContaining(["https://*.paypal.com", "https://*.paypalobjects.com", "https://*.venmo.com"]),
      );
    }
  });

  it("Agora: HTTPS and WebSocket on agora.io and sd-rtn.com, blob workers and media", () => {
    expect(directive(csp, "connect-src")).toEqual(
      expect.arrayContaining([
        "https://*.agora.io",
        "wss://*.agora.io",
        "https://*.sd-rtn.com",
        "wss://*.sd-rtn.com",
      ]),
    );
    expect(directive(csp, "worker-src")).toEqual(["'self'", "blob:"]);
    expect(directive(csp, "media-src")).toEqual(expect.arrayContaining(["'self'", "blob:"]));
  });

  it("LessonSpace: classroom frame, including the room.sh client_url host", () => {
    expect(directive(csp, "frame-src")).toEqual(
      expect.arrayContaining(["https://*.thelessonspace.com", "https://*.room.sh"]),
    );
  });

  it("Supabase: REST, Realtime, Storage images and media", () => {
    expect(directive(csp, "connect-src")).toEqual(
      expect.arrayContaining(["https://*.supabase.co", "wss://*.supabase.co"]),
    );
    expect(directive(csp, "img-src")).toContain("https://*.supabase.co");
    expect(directive(csp, "media-src")).toContain("https://*.supabase.co");
  });

  it("Sentry ingest", () => {
    expect(directive(csp, "connect-src")).toContain("https://*.sentry.io");
  });

  it("Cloudflare Turnstile, ready for PR D", () => {
    expect(directive(csp, "script-src")).toContain("https://challenges.cloudflare.com");
    expect(directive(csp, "frame-src")).toContain("https://challenges.cloudflare.com");
    expect(directive(csp, "connect-src")).toContain("https://challenges.cloudflare.com");
  });

  it("adds 'unsafe-eval' only for next dev", () => {
    expect(directive(csp, "script-src")).not.toContain("'unsafe-eval'");
    expect(directive(buildCsp({ dev: true }), "script-src")).toContain("'unsafe-eval'");
  });

  it("has no report-uri without a DSN, and Sentry's endpoint with one", () => {
    expect(csp).not.toContain("report-uri");
    const uri = "https://o1.ingest.de.sentry.io/api/2/security/?sentry_key=abc";
    expect(directive(buildCsp({ reportUri: uri }), "report-uri")).toEqual([uri]);
  });

  it("lists no host twice in a directive", () => {
    for (const d of csp.split(";")) {
      const values = d.trim().split(/\s+/).slice(1);
      expect(new Set(values).size).toBe(values.length);
    }
  });
});

describe("sentryCspReportUri", () => {
  it("turns a DSN into Sentry's security endpoint", () => {
    expect(sentryCspReportUri("https://abc123@o456.ingest.de.sentry.io/789")).toBe(
      "https://o456.ingest.de.sentry.io/api/789/security/?sentry_key=abc123",
    );
  });

  it("returns undefined for a missing or malformed DSN", () => {
    expect(sentryCspReportUri(undefined)).toBeUndefined();
    expect(sentryCspReportUri("")).toBeUndefined();
    expect(sentryCspReportUri("not a url")).toBeUndefined();
    expect(sentryCspReportUri("https://o456.ingest.sentry.io/789")).toBeUndefined();
  });
});

describe("next.config.ts headers()", () => {
  it("applies the security headers to every path and keeps the /brand cache rule", async () => {
    const rules = await config.headers!();
    const all = rules.find((r) => r.source === "/(.*)");
    expect(all?.headers).toEqual(
      buildSecurityHeaders({ reportUri: sentryCspReportUri(process.env.NEXT_PUBLIC_SENTRY_DSN) }),
    );
    const brand = rules.find((r) => r.source === "/brand/:file*");
    expect(brand?.headers).toEqual([
      { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
    ]);
  });
});
