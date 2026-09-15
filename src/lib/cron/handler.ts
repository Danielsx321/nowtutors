import "server-only";
import { NextResponse } from "next/server";
import { cronAuthFailure } from "@/lib/auth/api-guards";
import { cronFailureMessage, reportCronFailure, runCronJob } from "./jobs";
import type { CronJobName } from "./job-names";

/**
 * The HTTP side of a §12 job: bearer guard first (fails closed on a missing
 * `CRON_SECRET`), then the shared job body from `jobs.ts`, then the summary as
 * JSON. A job that throws answers 500 with a detail-free message.
 *
 * Every `app/api/cron/*` route is `export const GET = cronHandler("<name>")`,
 * so the scheduler and the admin "run now" button can never run different code.
 */
export function cronHandler(job: CronJobName) {
  return async function handler(request: Request): Promise<NextResponse> {
    const denied = cronAuthFailure(request, job);
    if (denied) return denied;
    try {
      return NextResponse.json(await runCronJob(job));
    } catch (err) {
      reportCronFailure(job, err);
      return NextResponse.json({ error: cronFailureMessage(job) }, { status: 500 });
    }
  };
}
