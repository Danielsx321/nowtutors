import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CRON_JOB_INFO,
  CRON_JOB_NAMES,
  isCronJobName,
} from "@/lib/cron/job-names";

/**
 * Pins the "run now" job list to the real cron routes (SPEC §12; Phase 8
 * Part 4), and pins every route to the shared job body, so the scheduler and
 * the admin button can't run different code.
 */

const CRON_DIR = join(process.cwd(), "src/app/api/cron");
const routeDirs = readdirSync(CRON_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

describe("cron job registry", () => {
  it("lists exactly the jobs that have a route", () => {
    expect([...CRON_JOB_NAMES].sort()).toEqual(routeDirs);
  });

  it("has schedule info for every job", () => {
    for (const name of CRON_JOB_NAMES) {
      expect(CRON_JOB_INFO[name].schedule, name).toBeTruthy();
      expect(CRON_JOB_INFO[name].what, name).toBeTruthy();
    }
  });

  it.each(routeDirs)("route %s is the shared handler and nothing else", (dir) => {
    const source = readFileSync(join(CRON_DIR, dir, "route.ts"), "utf8");
    const imports = source.split("\n").filter((l) => l.startsWith("import "));
    expect(imports).toEqual(['import { cronHandler } from "@/lib/cron/handler";']);
    expect(source).toContain(`export const GET = cronHandler("${dir}");`);
    expect(source).toContain("export const POST = GET;");
    expect(source).toContain('export const runtime = "nodejs";');
    expect(source).toContain('export const dynamic = "force-dynamic";');
  });

  it("refuses anything that isn't a job name", () => {
    expect(isCronJobName("reconcile-wallets")).toBe(true);
    for (const v of ["nope", "../reconcile-wallets", "", null, 1, undefined]) {
      expect(isCronJobName(v)).toBe(false);
    }
  });
});
