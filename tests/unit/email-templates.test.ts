import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { renderEmail } from "@emails/render";
import { SAMPLE_PROPS, templates } from "@emails/templates";
import type { EmailPropsByType, EmailType, Recipient } from "@/lib/email/types";
import { absoluteWhen, creditsLine, firstNameOf, slugToWords, usdLine } from "@/lib/email/format";

/**
 * Every template renders to HTML and plain text with a subject, a link into
 * the app and no AI tells (no em dash; `reference/writing-style.md`). The
 * masked PayPal address never appears in full, and the rejection note is
 * carried verbatim.
 */

const recipient: Recipient = {
  id: randomUUID(),
  email: "tina@example.com",
  fullName: "Tina Reyes",
  displayName: null,
  timezone: "Europe/Madrid",
  notificationPreferences: {},
};
const appUrl = (path = "/") => `https://nowtutors.test${path}`;

const EXPECTED_LINK: Record<EmailType, string> = {
  "tutor-welcome": "/tutor/pending-approval",
  "tutor-approved": "/tutor",
  "tutor-rejected": "/tutor/pending-approval",
  "withdrawal-requested": "/tutor/withdrawals",
  "withdrawal-paid": "/tutor/withdrawals",
  "withdrawal-rejected": "/tutor/withdrawals",
  "admin-new-tutor-application": "/admin/tutors",
  "admin-new-withdrawal": "/admin/withdrawals",
};

describe("email templates", () => {
  for (const type of Object.keys(templates) as EmailType[]) {
    it(`${type} renders with a subject, a link and no em dash`, async () => {
      const out = await renderEmail(type, SAMPLE_PROPS[type] as EmailPropsByType[typeof type], { recipient, appUrl });
      expect(out.subject.length).toBeGreaterThan(8);
      expect(out.html).toContain(`https://nowtutors.test${EXPECTED_LINK[type]}`);
      expect(out.text).toContain(`https://nowtutors.test${EXPECTED_LINK[type]}`);
      expect(out.html).toContain("nowtutors");
      expect(out.html).not.toContain("—");
      expect(out.text).not.toContain("—");
      expect(out.text.length).toBeGreaterThan(80);
    });
  }

  it("greets by first name and never prints a full PayPal address", async () => {
    const out = await renderEmail("withdrawal-paid", SAMPLE_PROPS["withdrawal-paid"], { recipient, appUrl });
    expect(out.subject).toBe("Your $30.66 withdrawal has been paid");
    expect(out.text).not.toContain("tina.reyes@example.com");
    expect(out.text).toContain("t•••s@example.com");
    expect(out.text).toContain("5PP12345AB678901C");
    expect(out.text).toContain("23 credits");
    // Each fact on its own line in the plain-text part, label and value apart.
    expect(out.text).toMatch(/Amount: \$30\.66 for 23 credits/);
    expect(out.text).toMatch(/Sent to: t•••s@example\.com/);
  });

  it("carries the rejection note verbatim", async () => {
    const note = "Your intro video has no sound.\nRe-upload it, then reply here.";
    const out = await renderEmail("tutor-rejected", { note }, { recipient, appUrl });
    expect(out.text).toContain("Your intro video has no sound.");
    expect(out.text).toContain("Re-upload it, then reply here.");
  });

  it("says 'there' when the recipient has no name", async () => {
    const out = await renderEmail("tutor-approved", {}, { recipient: { ...recipient, fullName: null }, appUrl });
    // The plain-text renderer upper-cases headings.
    expect(out.text).toMatch(/you're in, there\./i);
  });

  it("does not add a manage-notifications link to transactional types", async () => {
    const out = await renderEmail("tutor-approved", {}, { recipient, appUrl });
    expect(out.html).not.toContain("/dashboard/settings");
  });
});

describe("format helpers", () => {
  it("prints an absolute time with the zone", () => {
    const at = new Date("2026-10-02T15:30:00Z");
    expect(absoluteWhen(at, "Africa/Lagos")).toBe("Fri 2 Oct 2026, 4:30 PM (GMT+1)");
    expect(absoluteWhen(at, "UTC")).toBe("Fri 2 Oct 2026, 3:30 PM (UTC)");
    expect(absoluteWhen(at, "Not/AZone")).toBe("Fri 2 Oct 2026, 3:30 PM (UTC)");
    expect(absoluteWhen(at, null)).toBe("Fri 2 Oct 2026, 3:30 PM (UTC)");
  });

  it("pluralises credits and formats dollars", () => {
    expect(creditsLine(1)).toBe("1 credit");
    expect(creditsLine(23)).toBe("23 credits");
    expect(usdLine("30.66")).toBe("$30.66");
  });

  it("takes the first name, display name first", () => {
    expect(firstNameOf("Tina Reyes")).toBe("Tina");
    expect(firstNameOf("Tina Reyes", "T. Reyes")).toBe("T.");
    expect(firstNameOf(null)).toBe("there");
    expect(firstNameOf("   ")).toBe("there");
  });

  it("turns a subject slug into words", () => {
    expect(slugToWords("sat-act-test-prep")).toBe("Sat act test prep");
    expect(slugToWords("spanish")).toBe("Spanish");
  });
});
