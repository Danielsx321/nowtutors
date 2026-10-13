import { describe, expect, it } from "vitest";
import {
  CHANGE_REASONS,
  formatApprovalNote,
  isChangeReason,
  parseApprovalNote,
} from "@/lib/tutors/change-reasons";

/**
 * The reasons an admin ticks and the note they type share one text column
 * with the rejection note (tutor-request-changes). Format and parse must round
 * trip, a plain rejection note must read back unchanged, and nothing the
 * tutor cannot be shown (an unknown key) may survive the parse.
 */
describe("change reasons", () => {
  it("round trips reasons and a note", () => {
    const text = formatApprovalNote(["photo", "rate"], "  A plain background works best.  ");
    expect(text).toBe("reasons: photo,rate\n\nA plain background works best.");
    expect(parseApprovalNote(text)).toEqual({
      reasons: ["photo", "rate"],
      note: "A plain background works best.",
    });
  });

  it("round trips reasons with no note", () => {
    const text = formatApprovalNote(["photo"], "");
    expect(text).toBe("reasons: photo");
    expect(parseApprovalNote(text)).toEqual({ reasons: ["photo"], note: null });
  });

  it("stores a note alone as plain text, so a rejection note reads back as before", () => {
    expect(formatApprovalNote([], "Your intro video has no sound.")).toBe("Your intro video has no sound.");
    expect(parseApprovalNote("Your intro video has no sound.")).toEqual({
      reasons: [],
      note: "Your intro video has no sound.",
    });
    expect(parseApprovalNote(null)).toEqual({ reasons: [], note: null });
    expect(parseApprovalNote("   ")).toEqual({ reasons: [], note: null });
  });

  it("drops unknown and repeated keys", () => {
    expect(parseApprovalNote("reasons: photo, bogus ,photo\n\nx")).toEqual({ reasons: ["photo"], note: "x" });
    expect(formatApprovalNote(["photo", "photo"], "")).toBe("reasons: photo");
    expect(isChangeReason("photo")).toBe(true);
    expect(isChangeReason("bogus")).toBe(false);
  });

  it("every reason has a label and guidance without an em dash", () => {
    for (const r of CHANGE_REASONS) {
      expect(r.label.length).toBeGreaterThan(3);
      expect(r.guidance.length).toBeGreaterThan(10);
      expect(r.label + r.guidance).not.toContain("—");
    }
  });
});
