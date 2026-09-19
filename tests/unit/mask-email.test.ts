import { describe, expect, it } from "vitest";
import { maskEmail } from "@/lib/withdrawals/mask-email";

describe("maskEmail", () => {
  it("keeps the first and last character of the name and the whole domain", () => {
    expect(maskEmail("daniel.dada@gmail.com")).toBe("d•••a@gmail.com");
  });

  it("never reveals a short name in full", () => {
    expect(maskEmail("ab@x.io")).toBe("a•••@x.io");
    expect(maskEmail("a@x.io")).toBe("a•••@x.io");
  });

  it("uses the last @ and survives malformed input", () => {
    expect(maskEmail("we@ird@pay.com")).toBe("w•••d@pay.com");
    expect(maskEmail("nope")).toBe("•••");
    expect(maskEmail("@x.io")).toBe("•••");
  });
});
