import { describe, expect, it, vi } from "vitest";
import {
  REMINDER_WINDOWS,
  runBookingRemindersSweep,
  type BookingRemindersPort,
  type ReminderKind,
} from "@/lib/bookings/booking-reminders";
import { isAway, OFFLINE_AFTER_MINUTES } from "@/lib/email/message-emails";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: {} }));

/**
 * The reminder sweep (SPEC §12) against a fake port: claim-then-send, a
 * claimed booking is never claimed again, one failure never stops the rest.
 * The claim's SQL is covered on the test project in
 * `tests/integration/booking-reminders.test.ts`.
 */

/** A fake store holding bookings by start time, claiming with the real windows. */
function fakePort(starts: Record<string, { startAt: Date; createdAt: Date }>, failOn: string[] = []) {
  const stamped: Record<ReminderKind, Set<string>> = { "24h": new Set(), "1h": new Set() };
  const sends: Array<[ReminderKind, string]> = [];
  const port: BookingRemindersPort = {
    async claim(kind, now, w) {
      const ids = Object.entries(starts)
        .filter(([id, b]) => {
          const ms = b.startAt.getTime() - now.getTime();
          return (
            !stamped[kind].has(id) &&
            ms > w.startsAfterMinutes * 60_000 &&
            ms <= w.startsWithinMinutes * 60_000 &&
            now.getTime() - b.createdAt.getTime() >= w.bookedAtLeastMinutesAgo * 60_000
          );
        })
        .map(([id]) => id);
      ids.forEach((id) => stamped[kind].add(id));
      return ids;
    },
    async send(kind, id) {
      sends.push([kind, id]);
      if (failOn.includes(id)) throw new Error("resend down");
      return { sent: kind === "24h" ? 1 : 2, failed: 0 };
    },
  };
  return { port, sends, stamped };
}

const NOW = new Date("2026-10-01T12:00:00Z");
const hours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);
const longAgo = new Date("2026-09-20T00:00:00Z");

describe("booking reminders sweep", () => {
  it("claims a session 23 hours out for 24h and one 45 minutes out for 1h", async () => {
    const { port, sends } = fakePort({
      tomorrow: { startAt: hours(23), createdAt: longAgo },
      soon: { startAt: hours(0.75), createdAt: longAgo },
      nextWeek: { startAt: hours(24 * 7), createdAt: longAgo },
      tooSoon: { startAt: hours(0.1), createdAt: longAgo },
    });
    const res = await runBookingRemindersSweep(port, NOW);
    expect(res.claimed24hIds).toEqual(["tomorrow"]);
    expect(res.claimed1hIds).toEqual(["soon"]);
    expect(res).toMatchObject({ sent: 3, failed: 0 });
    expect(sends).toEqual([
      ["24h", "tomorrow"],
      ["1h", "soon"],
    ]);
  });

  it("reminds once across overlapping runs", async () => {
    const { port, sends } = fakePort({ soon: { startAt: hours(0.75), createdAt: longAgo } });
    await runBookingRemindersSweep(port, NOW);
    await runBookingRemindersSweep(port, new Date(NOW.getTime() + 15 * 60_000));
    expect(sends).toEqual([["1h", "soon"]]);
  });

  it("does not remind a booking made minutes ago", async () => {
    const { port, sends } = fakePort({
      justBooked24: { startAt: hours(23), createdAt: new Date(NOW.getTime() - 10 * 60_000) },
      justBooked1: { startAt: hours(0.75), createdAt: new Date(NOW.getTime() - 10 * 60_000) },
    });
    await runBookingRemindersSweep(port, NOW);
    expect(sends).toEqual([]);
  });

  it("counts a failed send and carries on with the rest", async () => {
    const { port, sends } = fakePort(
      { a: { startAt: hours(0.5), createdAt: longAgo }, b: { startAt: hours(0.6), createdAt: longAgo } },
      ["a"],
    );
    const res = await runBookingRemindersSweep(port, NOW);
    expect(sends.map(([, id]) => id)).toEqual(["a", "b"]);
    expect(res).toMatchObject({ sent: 2, failed: 1 });
  });

  it("uses windows wider than the 15-minute cadence", () => {
    for (const w of Object.values(REMINDER_WINDOWS)) {
      expect(w.startsWithinMinutes - w.startsAfterMinutes).toBeGreaterThan(15);
    }
  });
});

describe("isAway (new-message email)", () => {
  it("is away after five minutes unseen, or when never seen", () => {
    expect(isAway(null, NOW)).toBe(true);
    expect(isAway(new Date(NOW.getTime() - (OFFLINE_AFTER_MINUTES * 60_000 + 1)), NOW)).toBe(true);
    expect(isAway(new Date(NOW.getTime() - 60_000), NOW)).toBe(false);
  });
});
