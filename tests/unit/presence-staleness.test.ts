import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isPresenceFresh,
  PRESENCE_STALE_SECONDS,
} from "@/lib/presence/staleness";

/**
 * SPEC §15: "Presence staleness — the `live_tutors` boundary at exactly the
 * threshold." This is the unit half of the regression suite around the original
 * stale-LIVE-tutor bug (§3.1); the E2E half is tests/e2e/presence-ungraceful-exit.spec.ts.
 *
 * The view's predicate is `last_seen_at > now() - interval '2 minutes'` — a
 * STRICT inequality. So a heartbeat exactly 2 minutes old is already OUT, and
 * the interesting cases are the three ticks either side of that edge.
 */

const NOW = new Date("2026-08-22T12:00:00.000Z");
const secondsAgo = (s: number) => new Date(NOW.getTime() - s * 1000);

describe("live_tutors staleness boundary", () => {
  it("treats a heartbeat just inside the window as fresh", () => {
    expect(isPresenceFresh(secondsAgo(119), NOW)).toBe(true);
    expect(isPresenceFresh(secondsAgo(119.999), NOW)).toBe(true);
  });

  it("treats a heartbeat at EXACTLY the threshold as stale (strict >)", () => {
    // The row whose last_seen_at is exactly now() - interval '2 minutes' does
    // not satisfy `last_seen_at > now() - interval '2 minutes'`.
    expect(isPresenceFresh(secondsAgo(PRESENCE_STALE_SECONDS), NOW)).toBe(false);
  });

  it("treats a heartbeat just past the threshold as stale", () => {
    expect(isPresenceFresh(secondsAgo(120.001), NOW)).toBe(false);
    expect(isPresenceFresh(secondsAgo(121), NOW)).toBe(false);
  });

  it("treats a future or just-now heartbeat as fresh", () => {
    expect(isPresenceFresh(NOW, NOW)).toBe(true);
    expect(isPresenceFresh(new Date(NOW.getTime() + 5_000), NOW)).toBe(true);
  });

  it("never counts a missing last_seen_at as fresh", () => {
    expect(isPresenceFresh(null, NOW)).toBe(false);
    expect(isPresenceFresh(undefined, NOW)).toBe(false);
  });
});

/**
 * The anti-drift check that lets the module above exist at all.
 *
 * §3.1 makes the view the single definition of stale. A TypeScript constant that
 * merely *claims* to mirror it would be a second definition the moment someone
 * retuned the view — so the constant is asserted against the interval literal
 * parsed straight out of the migration that creates the view.
 */
describe("PRESENCE_STALE_SECONDS mirrors the migration", () => {
  const migration = readFileSync(
    fileURLToPath(new URL("../../drizzle/0014_phase6_presence_cleanup.sql", import.meta.url)),
    "utf8",
  );

  it("finds exactly one live_tutors staleness interval in drizzle/0014", () => {
    const matches = [
      ...migration.matchAll(/last_seen_at\s*>\s*now\(\)\s*-\s*interval\s*'(\d+)\s*(minute|minutes|second|seconds)'/gi),
    ];
    expect(matches).toHaveLength(1);

    const [, amount, unit] = matches[0];
    const seconds = unit.startsWith("minute")
      ? Number(amount) * 60
      : Number(amount);
    expect(seconds).toBe(PRESENCE_STALE_SECONDS);
  });

  it("does not reintroduce presence_stale_seconds as executable SQL", () => {
    // The migration's prose says the setting does not exist, so strip comment
    // lines before asserting — what matters is that nothing SELECTs or INSERTs it.
    const executable = migration
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(executable).not.toMatch(/presence_stale_seconds/);
  });
});
