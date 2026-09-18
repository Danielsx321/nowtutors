import * as React from "react";
import { cn } from "@/lib/utils";

export interface BarDatum {
  label: string;
  value: number;
}

/** The smallest 1, 2 or 5 × 10ⁿ at or above `max`, so the top gridline is a round number. */
export function niceMax(max: number): number {
  if (!(max > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 5, 10]) {
    if (step * pow >= max) return step * pow;
  }
  return 10 * pow;
}

function formatValue(v: number) {
  return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

/**
 * A small bar chart for the dashboards (live-globe rebuild Part E; plan:
 * "no chart library"). One scale drives the bars and the three gridline
 * labels, so an axis can't disagree with a bar. The last bar (the current
 * period) is teal; the others are a light teal, both flat fills. Text colours
 * come from tokens.
 *
 * It is one image to assistive tech: `role="img"` with a label that reads every
 * value, since a screen reader can't see bar heights.
 */
export function BarChart({
  data,
  unit,
  title,
  className,
}: {
  data: BarDatum[];
  /** "hrs", "cr"... shown after values in the label and on the top gridline. */
  unit: string;
  /** What the chart shows, for the accessible label: "Hours learned per month". */
  title: string;
  className?: string;
}) {
  const W = 300;
  const H = 150;
  const pad = { top: 12, right: 4, bottom: 22, left: 30 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const top = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const y = (v: number) => pad.top + innerH - (v / top) * innerH;
  const slot = innerW / Math.max(1, data.length);
  const barW = Math.min(28, slot * 0.56);

  const summary = `${title}: ${data.map((d) => `${d.label} ${formatValue(d.value)} ${unit}`).join(", ")}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={summary}
      className={cn("block h-auto w-full", className)}
    >
      {[0, top / 2, top].map((tick) => (
        <g key={tick}>
          <line
            x1={pad.left}
            x2={W - pad.right}
            y1={y(tick)}
            y2={y(tick)}
            className="stroke-border"
            strokeDasharray={tick === 0 ? undefined : "3 4"}
          />
          <text
            x={pad.left - 6}
            y={y(tick)}
            dy="0.32em"
            textAnchor="end"
            className="fill-text-muted text-[10px]"
          >
            {formatValue(tick)}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const cx = pad.left + slot * i + slot / 2;
        const h = Math.max(0, y(0) - y(d.value));
        const current = i === data.length - 1;
        return (
          <g key={d.label + i}>
            {h > 0 && (
              <rect
                data-bar
                x={cx - barW / 2}
                y={y(d.value)}
                width={barW}
                height={h}
                rx={Math.min(6, barW / 2)}
                className={current ? "fill-primary" : "fill-primary/20"}
              />
            )}
            <text
              x={cx}
              y={H - 6}
              textAnchor="middle"
              className={cn("text-[11px]", current ? "fill-text font-semibold" : "fill-text-muted")}
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
