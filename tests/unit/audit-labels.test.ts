import { describe, expect, it } from "vitest";
import { auditActionLabel } from "@/lib/admin/audit-labels";

describe("auditActionLabel", () => {
  it("names known actions in plain words", () => {
    expect(auditActionLabel("tutor.approve")).toBe("Approved a tutor");
    expect(auditActionLabel("withdrawal.mark_paid")).toBe("Marked a withdrawal paid");
  });

  it("shows an unknown action as it is rather than guessing", () => {
    expect(auditActionLabel("thing.new_action")).toBe("thing.new_action");
  });
});
