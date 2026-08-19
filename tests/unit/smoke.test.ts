import { describe, it, expect } from "vitest";

// Phase 0 smoke test — proves the vitest step in CI is real. Replaced by the
// SPEC §15 unit suites (availability, ledger, pricing, presence, filters) as
// those subsystems land in later phases.
describe("phase 0 smoke", () => {
  it("runs the test pipeline", () => {
    expect(1 + 1).toBe(2);
  });
});
