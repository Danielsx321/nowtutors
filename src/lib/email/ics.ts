/**
 * One calendar event for one booking (RFC 5545), as plain text. A booking
 * confirmation carries it so the session lands in the student's and the
 * tutor's calendar with one tap (SPEC §11, "booking confirmed (with .ics)").
 *
 * No dependency: the format is a dozen lines. Times are written in UTC with
 * the `Z` suffix, so every calendar app shows them in its own zone. The UID is
 * the booking id, so a second invite for the same booking (a later reschedule,
 * should one ever exist) updates the event rather than adding another.
 */

export interface IcsEvent {
  bookingId: string;
  startAt: Date;
  endAt: Date;
  summary: string;
  description: string;
  url: string;
  /** When the invite was generated. Injected so tests are stable. */
  now: Date;
}

/** `20261002T153000Z` */
function icsTime(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** RFC 5545 §3.3.11: escape backslash, semicolon, comma and newlines in TEXT. */
function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** RFC 5545 §3.1: lines longer than 75 octets fold with CRLF and one space. */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Never split a multi-byte character: back off to a character boundary.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    limit = 74; // continuation lines start with a space
  }
  return parts.join("\r\n ");
}

export function bookingIcs(e: IcsEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//NowTutors//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.bookingId}@nowtutors`,
    `DTSTAMP:${icsTime(e.now)}`,
    `DTSTART:${icsTime(e.startAt)}`,
    `DTEND:${icsTime(e.endAt)}`,
    `SUMMARY:${escapeText(e.summary)}`,
    `DESCRIPTION:${escapeText(e.description)}`,
    `URL:${e.url}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
