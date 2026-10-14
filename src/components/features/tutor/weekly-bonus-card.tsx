import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Money } from "@/components/ui/money";
import { Progress } from "@/components/ui/progress";
import { formatHours, formatWeekRange } from "@/lib/availability-bonus/week";
import type { TutorAward, TutorWeekProgress } from "@/db/queries/availability-bonus";

export interface WeeklyBonusCardProps {
  progress: TutorWeekProgress;
  awards: TutorAward[];
  settings: { enabled: boolean; minHours: number; credits: number };
  /** The payout rate (tutor-side), for the "≈ $" anchor. Null hides it. */
  usdPerCredit: number | null;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * The weekly availability bonus on `/tutor/earnings` (SPEC §6, §7.5, §7.11;
 * availability-bonus, 2026-10-14): live hours so far this week against the
 * threshold, a day strip, and the weeks already paid. Hidden entirely when
 * the bonus is switched off, so nothing promises money that will not come.
 *
 * Hours count only while live (Go live on the dashboard), which the rule line
 * says in plain words. The week is Monday to Sunday UTC and is labelled with
 * its dates.
 */
export function WeeklyBonusCard({ progress, awards, settings, usdPerCredit }: WeeklyBonusCardProps) {
  if (!settings.enabled) return null;

  const minSeconds = Math.round(settings.minHours * 3600);
  const reached = progress.liveSeconds >= minSeconds;
  const percent = minSeconds > 0 ? Math.min(100, Math.round((progress.liveSeconds / minSeconds) * 100)) : 0;
  const remaining = Math.max(0, minSeconds - progress.liveSeconds);
  const thresholdLabel = Number.isInteger(settings.minHours)
    ? `${settings.minHours} ${settings.minHours === 1 ? "hour" : "hours"}`
    : formatHours(minSeconds);
  const showUsd = usdPerCredit != null;

  return (
    <Card data-testid="weekly-bonus-card">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Weekly availability bonus</CardTitle>
            <CardDescription>
              Be live for {thresholdLabel} between Monday and Sunday and{" "}
              <Money credits={settings.credits} usdPerCredit={usdPerCredit ?? undefined} showUsd={showUsd} size="sm" />{" "}
              lands in your wallet on Monday. Only time while you are live counts.
            </CardDescription>
          </div>
          {reached ? (
            <Badge variant="live">Reached this week</Badge>
          ) : (
            <Badge variant="neutral">{formatHours(remaining)} to go</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-small text-text-muted">This week, {formatWeekRange(progress.weekStart)}</p>
            <p data-numeric className="text-body font-semibold text-text">
              {formatHours(progress.liveSeconds)} <span className="font-normal text-text-muted">of {thresholdLabel}</span>
            </p>
          </div>
          <Progress
            className="mt-2"
            value={percent}
            tone={reached ? "live" : "primary"}
            size="md"
            aria-label={`Live hours this week: ${formatHours(progress.liveSeconds)} of ${thresholdLabel}`}
          />
          <ol className="mt-3 grid grid-cols-7 gap-1 text-center" aria-label="Live time by day">
            {progress.days.map((d, i) => (
              <li key={d.day} className="rounded-md bg-surface-muted px-1 py-1.5">
                <span className="block text-caption text-text-muted">{DAY_LABELS[i]}</span>
                <span data-numeric className="block text-small font-medium text-text">
                  {d.seconds > 0 ? formatHours(d.seconds) : "·"}
                </span>
              </li>
            ))}
          </ol>
        </div>

        {awards.length === 0 ? (
          <p className="text-small text-text-muted">No bonus paid yet. The first one comes the Monday after a week you reach the target.</p>
        ) : (
          <DataTable
            caption="Weekly bonuses paid"
            rows={awards}
            rowKey={(a) => a.id}
            minWidth={420}
            columns={[
              { key: "week", header: "Week", className: "whitespace-nowrap", cell: (a) => formatWeekRange(a.weekStart) },
              { key: "live", header: "Live for", align: "right", cell: (a) => formatHours(a.liveSeconds) },
              {
                key: "paid",
                header: "Paid",
                align: "right",
                cell: (a) => (
                  <Money credits={a.credits} usdPerCredit={usdPerCredit ?? undefined} showUsd={showUsd} size="sm" />
                ),
              },
            ]}
          />
        )}
      </CardContent>
    </Card>
  );
}
