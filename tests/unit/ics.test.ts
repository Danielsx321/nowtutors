import { describe, expect, it } from "vitest";
import { bookingIcs } from "@/lib/email/ics";

/** The calendar invite attached to booking confirmations (RFC 5545). */
describe("bookingIcs", () => {
  const base = {
    bookingId: "3f0c1b7e-0000-4000-8000-000000000001",
    startAt: new Date("2026-10-02T15:30:00Z"),
    endAt: new Date("2026-10-02T16:30:00Z"),
    summary: "NowTutors: Spanish with Tina Reyes",
    description: "Your 60 minutes Spanish session on NowTutors.",
    url: "https://nowtutors.com/dashboard/bookings/3f0c1b7e-0000-4000-8000-000000000001",
    now: new Date("2026-09-29T10:00:00Z"),
  };

  it("writes one UTC event with the booking id as UID and CRLF line ends", () => {
    const ics = bookingIcs(base);
    expect(ics).toBe(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//NowTutors//Booking//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        "UID:3f0c1b7e-0000-4000-8000-000000000001@nowtutors",
        "DTSTAMP:20260929T100000Z",
        "DTSTART:20261002T153000Z",
        "DTEND:20261002T163000Z",
        "SUMMARY:NowTutors: Spanish with Tina Reyes",
        "DESCRIPTION:Your 60 minutes Spanish session on NowTutors.",
        // 85 octets, so it folds at 75 with a leading space on the continuation.
        "URL:https://nowtutors.com/dashboard/bookings/3f0c1b7e-0000-4000-8000-000000",
        " 000001",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
      ].join("\r\n"),
    );
  });

  it("escapes commas, semicolons, backslashes and newlines in text", () => {
    const ics = bookingIcs({ ...base, summary: "Maths; algebra, part 2\\3", description: "Line one\nLine two" });
    expect(ics).toContain("SUMMARY:Maths\\; algebra\\, part 2\\\\3");
    expect(ics).toContain("DESCRIPTION:Line one\\nLine two");
  });

  it("never splits a multi-byte character when folding", () => {
    const ics = bookingIcs({ ...base, summary: "é".repeat(60) });
    for (const line of ics.split("\r\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
      expect(line).not.toContain("�");
    }
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain(`SUMMARY:${"é".repeat(60)}`);
  });
});
