import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `server-only` is a Next.js build-time guard with no runtime package in
// this repo (nothing else unit-tests a `server-only` module directly, for
// the same reason) — stubbed here so this Node test environment can import
// `lib/lessonspace/client.ts` at all.
vi.mock("server-only", () => ({}));

import {
  launchSpace,
  LessonSpaceApiError,
  LessonSpaceConfigError,
} from "@/lib/lessonspace/client";

/**
 * `lib/lessonspace/client.ts`'s wire format (SPEC §7.7). Once inferred, now
 * confirmed against LessonSpace's own developer docs and the live Bubble
 * app's API Connector definition — these tests pin the confirmed shape so a
 * regression back to the inferred one fails loudly:
 *
 *  - `Authorization: Organisation <key>`, not `Bearer` or `Token`.
 *  - the request body nests `user` (`{ name, leader }`) rather than flattening
 *    it, and carries exactly `id`/`user` — no duration, expiry or time limit.
 *  - the response's join link is `client_url`, not `url`; `secret` (a room
 *    credential) is never returned to the caller even though LessonSpace
 *    sends it back alongside `client_url`/`room_id`.
 */

const ORIGINAL_ENV = process.env.LESSONSPACE_API_KEY;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  process.env.LESSONSPACE_API_KEY = "test-key-123";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.env.LESSONSPACE_API_KEY = ORIGINAL_ENV;
});

describe("launchSpace — request wire format", () => {
  it("sends the Organisation auth scheme, explicit JSON content type, and the nested body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({
          client_url: "https://app.thelessonspace.com/space/abc?token=xyz",
          room_id: "room_abc",
          api_base: "https://api.thelessonspace.com",
          secret: "super-secret-room-credential",
          session_id: "sess_1",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await launchSpace({
      bookingId: "booking_1",
      displayName: "Ada Lovelace",
      leader: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.thelessonspace.com/v2/spaces/launch/");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Organisation test-key-123");
    expect(init.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      id: "booking_1",
      user: { name: "Ada Lovelace", leader: true },
    });
    expect(body.user.leader).toBe(true);
    expect(typeof body.user.leader).toBe("boolean");
  });

  it("sends leader: false, unquoted, for a student", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ client_url: "https://x", room_id: "room_1" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await launchSpace({
      bookingId: "booking_2",
      displayName: "Grace Hopper",
      leader: false,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({
      id: "booking_2",
      user: { name: "Grace Hopper", leader: false },
    });
  });
});

describe("launchSpace — response mapping", () => {
  it("maps client_url and room_id, and does not surface secret", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          client_url: "https://app.thelessonspace.com/space/abc?token=xyz",
          room_id: "room_abc",
          api_base: "https://api.thelessonspace.com",
          secret: "super-secret-room-credential",
          session_id: "sess_1",
        }),
      ),
    );

    const result = await launchSpace({
      bookingId: "booking_1",
      displayName: "Ada Lovelace",
      leader: true,
    });

    expect(result).toEqual({
      roomId: "room_abc",
      clientUrl: "https://app.thelessonspace.com/space/abc?token=xyz",
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("throws LessonSpaceApiError when client_url is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ room_id: "room_abc" })),
    );

    await expect(
      launchSpace({ bookingId: "b", displayName: "n", leader: true }),
    ).rejects.toBeInstanceOf(LessonSpaceApiError);
  });

  it("throws LessonSpaceApiError when room_id is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ client_url: "https://x" })),
    );

    await expect(
      launchSpace({ bookingId: "b", displayName: "n", leader: true }),
    ).rejects.toBeInstanceOf(LessonSpaceApiError);
  });

  it("throws LessonSpaceApiError carrying the status on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "nope" }, 401)),
    );

    const err = await launchSpace({
      bookingId: "b",
      displayName: "n",
      leader: true,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(LessonSpaceApiError);
    expect(err.status).toBe(401);
  });
});

describe("launchSpace — config boundary", () => {
  it("throws LessonSpaceConfigError, not a fetch call, when the API key is unset", async () => {
    delete process.env.LESSONSPACE_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      launchSpace({ bookingId: "b", displayName: "n", leader: true }),
    ).rejects.toBeInstanceOf(LessonSpaceConfigError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
