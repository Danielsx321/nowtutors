import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import agoraToken from "agora-token";
import {
  buildRtcToken,
  isValidAgoraCredential,
  WILDCARD_UID,
} from "@/lib/agora/token-builder";
import { sessionTokenLifetime, TOKEN_TTL_SECONDS } from "@/lib/agora/token-request";

/**
 * The in-app Agora token (SPEC §9, amended 2026-10-07; DECISIONS "Agora tokens
 * minted in-app").
 *
 * Every assertion decodes the token with Agora's own parser rather than trusting
 * the builder's arguments, so what is pinned is what Agora will read: the app id,
 * the channel, the wildcard uid, the privileges per role, and that no privilege
 * outlives the token (the T1 rule: a session token runs out with its session).
 *
 * The credentials are fake and obviously so. The real certificate lives only in
 * Vercel and the git-ignored env files.
 */

const APP_ID = "0".repeat(31) + "1";
const CERT = "0".repeat(31) + "2";
const OTHER_CERT = "0".repeat(31) + "3";

// Agora's parser, from the package itself. No types ship for this file, so the
// slice used here is typed locally.
// The parser hands strings back as Buffers, hence the String() at each read.
interface DecodedRtcService {
  __channel_name: Buffer | string;
  __uid: Buffer | string;
  __privileges: Record<number, number>;
}
interface DecodedToken {
  appId: Buffer | string;
  issueTs: number;
  expire: number;
  getServices(type: number): DecodedRtcService[];
  verifySignature(appCertificate: string): boolean;
}
interface AccessToken2Module {
  AccessToken2: new () => DecodedToken & { from_string(token: string): boolean };
  ServiceRtc: {
    kPrivilegeJoinChannel: number;
    kPrivilegePublishAudioStream: number;
    kPrivilegePublishVideoStream: number;
    kPrivilegePublishDataStream: number;
  };
  kRtcServiceType: number;
}
const { AccessToken2, ServiceRtc, kRtcServiceType } = createRequire(import.meta.url)(
  "agora-token/src/AccessToken2.js",
) as AccessToken2Module;

const JOIN = ServiceRtc.kPrivilegeJoinChannel;
const AUDIO = ServiceRtc.kPrivilegePublishAudioStream;
const VIDEO = ServiceRtc.kPrivilegePublishVideoStream;
const DATA = ServiceRtc.kPrivilegePublishDataStream;

function decode(token: string): { token: DecodedToken; rtc: DecodedRtcService } {
  const parsed = new AccessToken2();
  expect(parsed.from_string(token), "token parses").toBe(true);
  const services = parsed.getServices(kRtcServiceType);
  expect(services).toHaveLength(1);
  return { token: parsed, rtc: services[0] };
}

function build(overrides: Partial<Parameters<typeof buildRtcToken>[0]> = {}): string {
  return buildRtcToken({
    appId: APP_ID,
    appCertificate: CERT,
    channel: "session_6a1c2f74-1c2b-4a3e-9d8f-1b2c3d4e5f60",
    role: "publisher",
    ttlSeconds: TOKEN_TTL_SECONDS,
    ...overrides,
  });
}

describe("buildRtcToken", () => {
  it("builds an AccessToken2 (007) for the given app id", () => {
    const token = build();
    expect(token.startsWith("007")).toBe(true);
    expect(String(decode(token).token.appId)).toBe(APP_ID);
  });

  it("carries the channel it was given", () => {
    const { rtc } = decode(build({ channel: "broadcast_42" }));
    expect(String(rtc.__channel_name)).toBe("broadcast_42");
  });

  it("is minted for the wildcard uid, not a participant's uid", () => {
    // AccessToken2 encodes uid 0 as an empty string. The client joins under its
    // own deterministic uid (§9 step 4); the token authorizes the channel.
    expect(WILDCARD_UID).toBe(0);
    expect(String(decode(build()).rtc.__uid)).toBe("");
    const perUid = agoraToken.RtcTokenBuilder.buildTokenWithUid(
      APP_ID,
      CERT,
      "session_x",
      12345,
      agoraToken.RtcRole.PUBLISHER,
      600,
      600,
    );
    expect(String(decode(perUid).rtc.__uid)).toBe("12345");
  });

  it("gives a publisher join and all three publish privileges", () => {
    const { rtc } = decode(build({ role: "publisher" }));
    expect(Object.keys(rtc.__privileges).map(Number).sort()).toEqual(
      [JOIN, AUDIO, VIDEO, DATA].sort(),
    );
  });

  it("gives a subscriber join only, nothing to publish", () => {
    const { rtc } = decode(build({ role: "subscriber" }));
    expect(Object.keys(rtc.__privileges).map(Number)).toEqual([JOIN]);
  });

  it.each([TOKEN_TTL_SECONDS, 1260, 61])(
    "expires the token and every privilege at the same TTL (%i s)",
    (ttlSeconds) => {
      // Both are seconds after issueTs in AccessToken2. A privilege left at the
      // library default (0) would not expire with the token, quietly undoing the
      // rule that a token never outlives its session.
      for (const role of ["publisher", "subscriber"] as const) {
        const { token, rtc } = decode(build({ role, ttlSeconds }));
        expect(token.expire).toBe(ttlSeconds);
        for (const expiry of Object.values(rtc.__privileges)) {
          expect(expiry).toBe(ttlSeconds);
        }
      }
    },
  );

  it("takes a session-capped TTL straight from sessionTokenLifetime", () => {
    // 20 minutes left of a started session: the token lasts 20 min + 60 s grace.
    const now = new Date("2026-10-07T12:00:00.000Z");
    const life = sessionTokenLifetime(
      { startedAt: new Date("2026-10-07T11:40:00.000Z"), durationMinutes: 40 },
      now,
    );
    expect(life.ttlSeconds).toBe(1260);
    expect(decode(build({ ttlSeconds: life.ttlSeconds })).token.expire).toBe(1260);
  });

  it("is signed with the certificate it was given", () => {
    const { token } = decode(build());
    expect(token.verifySignature(CERT)).toBe(true);
    expect(token.verifySignature(OTHER_CERT)).toBe(false);
    expect(decode(build({ appCertificate: OTHER_CERT })).token.verifySignature(OTHER_CERT)).toBe(
      true,
    );
  });

  it("throws rather than returning an empty token for bad credentials", () => {
    // agora-token returns "" when the app id or certificate isn't 32 hex chars.
    // Handing "" to the browser would fail three layers away, inside Agora.
    expect(() => build({ appCertificate: "not-a-certificate" })).toThrow();
    expect(() => build({ appId: "" })).toThrow();
  });

  it("refuses a role it does not know", () => {
    expect(() => build({ role: "admin" as never })).toThrow();
  });

  it("never puts the certificate in an error message", () => {
    const leaky = "0".repeat(30) + "zz";
    try {
      build({ appCertificate: leaky });
      expect.unreachable();
    } catch (err) {
      expect(String(err)).not.toContain(leaky);
    }
  });
});

describe("isValidAgoraCredential", () => {
  it("accepts 32 hex characters, either case", () => {
    expect(isValidAgoraCredential(CERT)).toBe(true);
    expect(isValidAgoraCredential("ABCDEF0123456789abcdef0123456789")).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["31 chars", "0".repeat(31)],
    ["33 chars", "0".repeat(33)],
    ["a space inside", "0".repeat(15) + " " + "0".repeat(16)],
    ["a trailing space", "0".repeat(32) + " "],
    ["non-hex", "g".repeat(32)],
    ["undefined", undefined],
    ["a number", 12345],
  ])("rejects %s", (_label, value) => {
    expect(isValidAgoraCredential(value)).toBe(false);
  });
});
