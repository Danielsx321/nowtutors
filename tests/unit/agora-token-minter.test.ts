import { afterEach, describe, expect, it, vi } from "vitest";

// `server-only` is a Next.js build-time guard; stubbed so Node can import the
// minter (same as lessonspace-client.test.ts).
vi.mock("server-only", () => ({}));

import {
  agoraAppCertificate,
  agoraAppId,
  AgoraConfigError,
  AgoraTokenMintError,
  mintRtcToken,
} from "@/lib/agora/token-minter";
import { TOKEN_TTL_SECONDS } from "@/lib/agora/token-request";

/**
 * The server-only half of in-app minting: reading the two env vars, refusing a
 * certificate that can't be right, and turning any build failure into one error
 * the route maps to a clean response. The certificate's value must never appear
 * in an error, since errors are logged and reach Sentry.
 *
 * Fake credentials only.
 */

const APP_ID = "0".repeat(31) + "1";
const CERT = "0".repeat(31) + "2";

function setEnv(appId: string | undefined, cert: string | undefined) {
  vi.stubEnv("NEXT_PUBLIC_AGORA_APP_ID", appId as string);
  vi.stubEnv("AGORA_APP_CERTIFICATE", cert as string);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("agoraAppCertificate", () => {
  it("returns a well-formed certificate, trimmed", () => {
    setEnv(APP_ID, `  ${CERT}\n`);
    expect(agoraAppCertificate()).toBe(CERT);
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["31 chars", "0".repeat(31)],
    ["not hex", "z".repeat(32)],
    ["a space inside", "0".repeat(16) + " " + "0".repeat(15)],
  ])("is a config error when %s, naming the variable and not the value", (_label, value) => {
    setEnv(APP_ID, value);
    let caught: unknown;
    try {
      agoraAppCertificate();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AgoraConfigError);
    expect((caught as Error).message).toContain("AGORA_APP_CERTIFICATE");
    if (value) expect((caught as Error).message).not.toContain(value.trim());
  });

  it("is a config error when the App ID was pasted in by mistake", () => {
    setEnv(APP_ID, APP_ID);
    expect(() => agoraAppCertificate()).toThrow(AgoraConfigError);
  });
});

describe("agoraAppId", () => {
  it("is a config error when unset", () => {
    setEnv(undefined, CERT);
    expect(() => agoraAppId()).toThrow(AgoraConfigError);
  });
});

describe("mintRtcToken", () => {
  it("mints a token for the configured app", () => {
    setEnv(APP_ID, CERT);
    const token = mintRtcToken("session_abc", "publisher");
    expect(token.startsWith("007")).toBe(true);
  });

  it("defaults to the standard TTL", () => {
    setEnv(APP_ID, CERT);
    // Decoded in agora-token-builder.test.ts; here only that the default path works.
    expect(() => mintRtcToken("session_abc", "subscriber")).not.toThrow();
    expect(TOKEN_TTL_SECONDS).toBe(3600);
  });

  it("is a config error, not a mint error, when the certificate is missing", () => {
    setEnv(APP_ID, undefined);
    expect(() => mintRtcToken("session_abc", "publisher")).toThrow(AgoraConfigError);
  });

  it.each([0, -1, 86_401, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses a TTL of %s (Agora allows 1 s to 24 h)",
    (ttl) => {
      setEnv(APP_ID, CERT);
      expect(() => mintRtcToken("session_abc", "publisher", ttl)).toThrow(AgoraTokenMintError);
    },
  );

  it("wraps a build failure in AgoraTokenMintError without the certificate in it", () => {
    // A malformed App ID gets past agoraAppId (non-empty) and fails in the builder.
    setEnv("not-an-app-id", CERT);
    let caught: unknown;
    try {
      mintRtcToken("session_abc", "publisher");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AgoraTokenMintError);
    expect(String(caught)).not.toContain(CERT);
    expect(JSON.stringify(caught)).not.toContain(CERT);
  });
});
