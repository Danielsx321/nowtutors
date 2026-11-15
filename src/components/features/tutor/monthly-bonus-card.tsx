import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Money } from "@/components/ui/money";
import { Progress } from "@/components/ui/progress";
import { formatHours, formatMonth } from "@/lib/availability-bonus/month";
import type { TutorMonthlyAward, TutorMonthProgress } from "@/db/queries/availability-bonus";

export interface MonthlyBonusCardProps {
  progress: TutorMonthProgress;
  awards: TutorMonthlyAward[];
  settings: { enabled: boolean; minHours: number; credits: number };
  /** The payout rate (tutor-side), for the "≈ $" anchor. Null hides it. */
  usdPerCredit: number | null;
}

/**
 * The monthly availability bonus on `/tutor/earnings` (SPEC §6, §7.5, §7.11;
 * monthly-availability-bonus, 2026-11-15): live hours so far this month
 * against the threshold, days left, and the months already paid. Hidden
 * entirely when the bonus is switched off, so nothing promises money that will
 * not come.
 *
 * Hours count only while live (Go live on the dashboard). The month is a UTC
 * calendar month, labelled by name. The bonus lands on the 1st after the month
 * ends, which is why it can only be withdrawn then.
 */
export function MonthlyBonusCard({ progress, awards, settings, usdPerCredit }: MonthlyBonusCardProps) {
  if (!settings.enabled) return null;

  const minSeconds = Math.round(settings.minHours * 3600);
  const reached = progress.liveSeconds >= minSeconds;
  const percent = minSeconds > 0 ? Math.min(100, Math.round((progress.liveSeconds / minSeconds) * 100)) : 0;
  const remaining = Math.max(0, minSeconds - progress.liveSeconds);
  const thresholdLabel = Number.isInteger(settings.minHours)
    ? `${settings.minHours} ${settings.minHours === 1 ? "hour" : "hours"}`
    : formatHours(minSeconds);
  const showUsd = usdPerCredit != null;
  const daysLabel = `${progress.daysLeft} ${progress.daysLeft === 1 ? "day" : "days"} left this month`;

  return (
    <Card data-testid="monthly-bonus-card">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Monthly availability bonus</CardTitle>
            <CardDescription>
              Be live for {thresholdLabel} in a calendar month and{" "}
              <Money credits={settings.credits} usdPerCredit={usdPerCredit ?? undefined} showUsd={showUsd} size="sm" />{" "}
              lands in your wallet on the 1st of the next month. Only time while you are live counts.
            </CardDescription>
          </div>
          {reached ? (
            <Badge variant="live">Reached this month</Badge>
          ) : (
            <Badge variant="neutral">{formatHours(remaining)} to go</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-small text-text-muted">This month, {formatMonth(progress.monthStart)}</p>
            <p data-numeric className="text-body font-semibold text-text">
              {formatHours(progress.liveSeconds)} <span className="font-normal text-text-muted">of {thresholdLabel}</span>
            </p>
          </div>
          <Progress
            className="mt-2"
            value={percent}
            tone={reached ? "live" : "primary"}
            size="md"
            aria-label={`Live hours this month: ${formatHours(progress.liveSeconds)} of ${thresholdLabel}`}
          />
          <p className="mt-2 text-caption text-text-muted">{daysLabel}</p>
        </div>

        {awards.length === 0 ? (
          <p className="text-small text-text-muted">
            No monthly bonus paid yet. It is paid on the 1st, for the month before, once you reach the target.
          </p>
        ) : (
          <DataTable
            caption="Monthly bonuses paid"
            rows={awards}
            rowKey={(a) => a.id}
            minWidth={420}
            columns={[
              { key: "month", header: "Month", className: "whitespace-nowrap", cell: (a) => formatMonth(a.monthStart) },
              { key: "live", header: "Live for", align: "right", cell: (a) => formatHours(a.liveSeconds) },
              {
                key: "paid",
                header: "Paid",
                align: "right",
                cell: (a) => (
                  <span className="inline-flex flex-col items-end">
                    <Money credits={a.credits} usdPerCredit={usdPerCredit ?? undefined} showUsd={showUsd} size="sm" />
                    {a.weeklyCreditsDeducted > 0 && (
                      <span className="text-caption text-text-muted">after {a.weeklyCreditsDeducted} paid weekly</span>
                    )}
                  </span>
                ),
              },
            ]}
          />
        )}
      </CardContent>
    </Card>
  );
}
