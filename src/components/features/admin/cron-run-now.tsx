"use client";

import * as React from "react";
import { Play } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { runCronNow } from "@/actions/admin-settings";
import type { CronJobName } from "@/lib/cron/job-names";

export interface RunNowJob {
  name: CronJobName;
  schedule: string;
  what: string;
}

function JobCard({ job }: { job: RunNowJob }) {
  const [confirming, setConfirming] = React.useState(false);
  const [result, setResult] = React.useState<
    { ok: true; summary: unknown } | { ok: false; error: string } | null
  >(null);
  const [pending, start] = React.useTransition();

  const run = () =>
    start(async () => {
      setResult(null);
      const res = await runCronNow({ job: job.name });
      setConfirming(false);
      setResult("error" in res ? { ok: false, error: res.error } : { ok: true, summary: res.summary });
    });

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-body-lg font-bold text-text">{job.name}</p>
            <p className="text-small text-text-muted">{job.schedule}</p>
          </div>
          <div className="flex gap-2">
            {confirming ? (
              <>
                <Button size="sm" loading={pending} onClick={run}>
                  Confirm run
                </Button>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
                <Play aria-hidden />
                Run now
              </Button>
            )}
          </div>
        </div>
        <p className="text-small text-text">{job.what}</p>
        {result && !result.ok && <Alert variant="danger">{result.error}</Alert>}
        {result && result.ok && (
          <pre className="max-h-72 overflow-auto rounded-md bg-surface-muted p-3 text-caption text-text">
            {JSON.stringify(result.summary, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * "Run now" for every §12 job (Phase 8 Part 4). A two-step click, because a
 * few of these move money (release-earnings) or close sessions. They are all
 * idempotent, so the confirm guards against a slip, not against harm. The
 * result is the same summary the scheduled run logs.
 */
export function CronRunNow({ jobs }: { jobs: RunNowJob[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {jobs.map((job) => (
        <JobCard key={job.name} job={job} />
      ))}
    </div>
  );
}
