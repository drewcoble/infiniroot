import {
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useElementSize } from "@mantine/hooks";
import { GRID, TEXT } from "./chartTheme";
import classes from "./charts.module.css";

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
}

// One week's column. `values` follows the chart's series order and stacks
// bottom-up. "dnp": his team played, he didn't. "bye": no team game.
export interface WeeklyBarDatum {
  week: number;
  kind: "played" | "dnp" | "bye";
  values: number[];
}

const MARGIN = { top: 6, right: 2, bottom: 16, left: 24 };
// Bars cap at 24px thick and never fill their slot - the leftover is air.
const MAX_BAR = 24;
const BAR_SHARE = 0.62;
// Surface gap between stacked segments.
const STACK_GAP = 2;
const END_RADIUS = 4;

// Rect with only its top corners rounded - the data end. The baseline end
// stays square.
function topRoundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.min(r, w / 2, h);
  return [
    `M${x},${y + h}`,
    `V${y + radius}`,
    `A${radius},${radius} 0 0 1 ${x + radius},${y}`,
    `H${x + w - radius}`,
    `A${radius},${radius} 0 0 1 ${x + w},${y + radius}`,
    `V${y + h}`,
    "Z",
  ].join(" ");
}

// Clean round tick values from 0 to the domain's top.
function niceTicks(max: number): number[] {
  if (max <= 0) return [0];
  const rough = max / 2;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? rough;
  const ticks: number[] = [];
  for (let value = 0; value <= max + 1e-9; value += step) ticks.push(Math.round(value * 100) / 100);
  return ticks;
}

// Week-by-week column chart - one series, or several stacked (usage's rush
// + receiving = total). `barLabel` prints each week's number over its bar.
// With a `readout`, a week can also be tapped, hovered, or arrow-keyed to
// name it in a line above the chart (the rest dim so it stands out). Byes
// and missed games keep their slot (a gap in the season is information),
// drawn as a muted stub rather than an empty hole.
export function WeeklyBars({
  data,
  series,
  max,
  height = 96,
  reference,
  barLabel,
  readout,
  ariaLabel,
}: {
  data: WeeklyBarDatum[];
  series: ChartSeries[];
  // Top of the y-axis - defaults to the tallest stack.
  max?: number | undefined;
  height?: number;
  // A horizontal guide (season average) - named in the legend, not on the
  // plot, so it never collides with the bars.
  reference?: { value: number; label: string } | undefined;
  // Small number over a played week's bar - given the week and its stack
  // total; null for none.
  barLabel?: ((datum: WeeklyBarDatum, total: number) => string | null) | undefined;
  // What the line above the chart says for the picked week, or with nothing
  // picked (null). Absent = no readout, and the bars aren't pickable.
  readout?: ((datum: WeeklyBarDatum | null) => ReactNode) | undefined;
  ariaLabel: string;
}) {
  const { ref, width } = useElementSize();
  const [active, setActive] = useState<number | null>(null);

  const totals = data.map((datum) => datum.values.reduce((sum, value) => sum + value, 0));
  const top = max ?? Math.max(1, ...totals, reference?.value ?? 0);
  const ticks = niceTicks(top);
  const domainTop = Math.max(top, ticks[ticks.length - 1] ?? top);

  // Bar labels need headroom over the tallest bar.
  const marginTop = barLabel ? MARGIN.top + 12 : MARGIN.top;
  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const plotHeight = height - marginTop - MARGIN.bottom;
  const slot = data.length > 0 ? plotWidth / data.length : 0;
  const barWidth = Math.min(MAX_BAR, slot * BAR_SHARE);
  const y = (value: number) => marginTop + plotHeight - (value / domainTop) * plotHeight;
  const baseline = marginTop + plotHeight;
  // Every week number when there's room, otherwise every other one.
  const labelEvery = slot >= 16 ? 1 : 2;

  const onKeyDown = (event: KeyboardEvent) => {
    if (data.length === 0) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      setActive((current) =>
        current === null
          ? step > 0
            ? 0
            : data.length - 1
          : (current + step + data.length) % data.length,
      );
    } else if (event.key === "Escape") {
      setActive(null);
    }
  };

  const activeDatum = active !== null ? (data[active] ?? null) : null;

  return (
    <div className={classes.chart}>
      {readout && (
        <div className={classes.readout} aria-live="polite">
          {readout(activeDatum)}
        </div>
      )}
      <div ref={ref}>
        {width > 0 && (
          <svg
            className={classes.svg}
            width={width}
            height={height}
            role="img"
            aria-label={ariaLabel}
            {...(readout
              ? {
                  tabIndex: 0,
                  onKeyDown,
                  onPointerLeave: (event: ReactPointerEvent<SVGSVGElement>) => {
                    if (event.pointerType === "mouse") setActive(null);
                  },
                }
              : {})}
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={MARGIN.left}
                  x2={width - MARGIN.right}
                  y1={y(tick)}
                  y2={y(tick)}
                  stroke={GRID}
                  strokeWidth={1}
                />
                <text
                  className={classes.axisText}
                  x={MARGIN.left - 6}
                  y={y(tick)}
                  textAnchor="end"
                  dominantBaseline="middle"
                >
                  {tick}
                </text>
              </g>
            ))}

            {/* Behind the bars, so it never cuts through a bar or its label. */}
            {reference && (
              <line
                x1={MARGIN.left}
                x2={width - MARGIN.right}
                y1={y(reference.value)}
                y2={y(reference.value)}
                stroke={TEXT.secondary}
                strokeWidth={1.5}
                pointerEvents="none"
              />
            )}

            {data.map((datum, index) => {
              const cx = MARGIN.left + slot * index + slot / 2;
              const x = cx - barWidth / 2;
              const dimmed = active !== null && active !== index;
              let stackTop = baseline;
              const lastFilled = datum.values.reduce(
                (last, value, valueIndex) => (value > 0 ? valueIndex : last),
                -1,
              );
              return (
                <g key={datum.week} opacity={dimmed ? 0.4 : 1}>
                  {datum.kind === "played" &&
                    datum.values.map((value, valueIndex) => {
                      if (value <= 0) return null;
                      const h = (value / domainTop) * plotHeight;
                      // Every segment above the first gives up STACK_GAP at
                      // its base - the surface gap between segments.
                      const gap = stackTop < baseline ? STACK_GAP : 0;
                      const segmentTop = stackTop - h;
                      const segmentHeight = Math.max(0, h - gap);
                      stackTop = segmentTop;
                      const color = series[valueIndex]?.color ?? TEXT.secondary;
                      return valueIndex === lastFilled ? (
                        <path
                          key={valueIndex}
                          d={topRoundedRect(x, segmentTop, barWidth, segmentHeight, END_RADIUS)}
                          fill={color}
                        />
                      ) : (
                        <rect
                          key={valueIndex}
                          x={x}
                          y={segmentTop}
                          width={barWidth}
                          height={segmentHeight}
                          fill={color}
                        />
                      );
                    })}
                  {barLabel && datum.kind === "played" && totals[index] !== undefined && (
                    <text
                      className={classes.columnLabel}
                      x={cx}
                      y={y(totals[index] ?? 0) - 4}
                      textAnchor="middle"
                    >
                      {barLabel(datum, totals[index] ?? 0)}
                    </text>
                  )}
                  {datum.kind === "dnp" && (
                    <rect
                      x={x}
                      y={baseline - 2}
                      width={barWidth}
                      height={2}
                      rx={1}
                      fill={TEXT.muted}
                    />
                  )}
                  {(index % labelEvery === 0 || active === index) && (
                    <text
                      className={classes.axisText}
                      x={cx}
                      y={height - 3}
                      textAnchor="middle"
                      style={active === index ? { fill: TEXT.primary } : undefined}
                    >
                      {datum.kind === "bye" ? "B" : datum.week}
                    </text>
                  )}
                  {readout && (
                    // The whole slot is the hit target, not just the bar.
                    <rect
                      x={MARGIN.left + slot * index}
                      y={marginTop}
                      width={slot}
                      height={plotHeight + MARGIN.bottom}
                      fill="transparent"
                      onPointerEnter={(event) => {
                        if (event.pointerType === "mouse") setActive(index);
                      }}
                      // A mouse already picked this week on hover, so its click
                      // keeps it; a tap toggles it on and off.
                      onClick={(event) => {
                        const pointerType = (event.nativeEvent as PointerEvent).pointerType;
                        if (pointerType === "mouse") setActive(index);
                        else setActive((current) => (current === index ? null : index));
                      }}
                    />
                  )}
                </g>
              );
            })}

          </svg>
        )}
      </div>
      {(series.length > 1 || reference) && (
        <div className={classes.legend}>
          {series.length > 1 &&
            series.map((entry) => (
              <span key={entry.key} className={classes.legendItem}>
                <span className={classes.swatch} style={{ background: entry.color }} />
                {entry.label}
              </span>
            ))}
          {reference && (
            <span className={classes.legendItem}>
              <span className={classes.swatchLine} style={{ background: TEXT.secondary }} />
              {reference.label}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
