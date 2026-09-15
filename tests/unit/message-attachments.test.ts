import { describe, expect, it } from "vitest";
import {
  attachmentObjectPath,
  attachmentRefusalMessage,
  isAttachmentPathFor,
  MAX_ATTACHMENT_BYTES,
  MAX_NAME_CHARS,
  parseAttachmentPath,
  safeFileName,
  validateAttachment,
} from "@/lib/messaging/attachments";

/**
 * Message attachment rules (SPEC §7.9; Phase 9 Part 2, settled 2026-09-15:
 * jpg, png and PDF up to 10 MB, one per message).
 */

const CONV = "33333333-3333-4333-8333-333333333333";
const OTHER_CONV = "44444444-4444-4444-8444-444444444444";
const OBJ = "55555555-5555-4555-8555-555555555555";

describe("validateAttachment", () => {
  it.each([
    ["photo.jpg", "image/jpeg", "image"],
    ["photo.JPEG", "image/jpeg", "image"],
    ["scan.png", "image/png", "image"],
    ["worksheet.pdf", "application/pdf", "pdf"],
  ])("accepts %s as %s", (name, type, kind) => {
    expect(validateAttachment({ name, type, size: 1024 })).toEqual({ ok: true, kind });
  });

  it.each([
    ["notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["clip.webp", "image/webp"],
    ["page.html", "text/html"],
    ["invoice.pdf", "text/html"],
    ["photo.html", "image/png"],
    ["noextension", "image/png"],
    ["", "application/pdf"],
  ])("refuses %s (%s)", (name, type) => {
    expect(validateAttachment({ name, type, size: 1024 })).toEqual({
      ok: false,
      reason: "attachment_type",
    });
  });

  it("accepts exactly 10 MB and refuses one byte more", () => {
    expect(validateAttachment({ name: "a.pdf", type: "application/pdf", size: MAX_ATTACHMENT_BYTES }).ok).toBe(true);
    expect(
      validateAttachment({ name: "a.pdf", type: "application/pdf", size: MAX_ATTACHMENT_BYTES + 1 }),
    ).toEqual({ ok: false, reason: "attachment_too_large" });
  });

  it("refuses an empty file", () => {
    expect(validateAttachment({ name: "a.png", type: "image/png", size: 0 })).toEqual({
      ok: false,
      reason: "attachment_empty",
    });
  });
});

describe("safeFileName", () => {
  it("keeps an ordinary name", () => {
    expect(safeFileName("Chemistry-notes_v2.pdf")).toBe("Chemistry-notes_v2.pdf");
  });

  it("strips path traversal and separators", () => {
    const safe = safeFileName("../../etc/passwd.png");
    expect(safe).toBe("etc_passwd.png");
    expect(safe).not.toContain("/");
    expect(safe.startsWith(".")).toBe(false);
  });

  it("replaces spaces and symbols and never starts with a dot", () => {
    expect(safeFileName(".hidden file (1).jpg")).toBe("hidden_file_1.jpg");
  });

  it("falls back to 'file' when nothing safe is left", () => {
    expect(safeFileName("??.pdf")).toBe("file.pdf");
  });

  it("caps the length and keeps the extension", () => {
    const safe = safeFileName(`${"a".repeat(200)}.pdf`);
    expect(safe.length).toBe(MAX_NAME_CHARS);
    expect(safe.endsWith(".pdf")).toBe(true);
  });
});

describe("attachment paths", () => {
  it("builds a path that parses back to the same conversation, name and kind", () => {
    const path = attachmentObjectPath(CONV, OBJ, "My Scan.png");
    expect(path).toBe(`${CONV}/${OBJ}/My_Scan.png`);
    expect(parseAttachmentPath(path)).toEqual({ conversationId: CONV, name: "My_Scan.png", kind: "image" });
    expect(isAttachmentPathFor(CONV, path)).toBe(true);
  });

  it("refuses a path under another conversation", () => {
    expect(isAttachmentPathFor(CONV, `${OTHER_CONV}/${OBJ}/scan.png`)).toBe(false);
  });

  it.each([
    [`${CONV}/${OBJ}/../../x.png`],
    [`${CONV}/../${OTHER_CONV}/${OBJ}/x.png`],
    [`${CONV}/${OBJ}/.env.png`],
    [`${CONV}/${OBJ}/script.html`],
    [`${CONV}/not-a-uuid/x.png`],
    [`${CONV}/${OBJ}/sub/x.png`],
    [`/${CONV}/${OBJ}/x.png`],
    [`https://evil.example/${CONV}/${OBJ}/x.png`],
    [""],
  ])("rejects the malformed path %s", (path) => {
    expect(isAttachmentPathFor(CONV, path)).toBe(false);
  });

  it("has wording for every refusal", () => {
    for (const r of ["attachment_type", "attachment_too_large", "attachment_empty", "attachment_missing"] as const) {
      expect(attachmentRefusalMessage(r).length).toBeGreaterThan(0);
    }
  });
});
