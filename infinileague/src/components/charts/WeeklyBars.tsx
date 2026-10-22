import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useElementSize } from "@mantine/hooks";
import { GRID, NEUTRAL_MARK, SURFACE, TEXT } from "./chartTheme";
import classes from "./charts.module.css";

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  // Draw the marks as glass in `color`, the way the app's badges are (see
  // GlassMatchupCard.module.css's .pill) - a translucent tint with a brighter
  // edge - instead of a solid fill, so a bar in a position's color reads the
  // same as that position's badge.
  glass?: boolean;
}

// The badge's glass recipe (.pill): a 38% tint, edged at 50% - mixed onto
// the card's surface rather than left see-through, so the average line
// behind a bar doesn't show through it.
function markPaint(series: ChartSeries | undefined): {
  fill: string;
  stroke?: string;
  strokeWidth?: number;
} {
  const color = series?.color ?? TEXT.secondary;
  if (!series?.glass) return { fill: color };
  return {
    fill: `color-mix(in srgb, ${color} 38%, ${SURFACE})`,
    stroke: `color-mix(in srgb, ${color} 50%, rgba(255, 255, 255, 0.15))`,
    strokeWidth: 1,
  };
}

function swatchStyle(series: ChartSeries): CSSProperties {
  const paint = markPaint(series);
  return {
    background: paint.fill,
    ...(paint.stroke ? { border: `1px solid ${paint.stroke}` } : {}),
  };
}

// One week's column. `values` follows the chart's series order and stacks
// bottom-up. "dnp": his team played, he didn't. "bye": no team game.
// "projected": a week not played yet - one gray dashed outline at the
// values' total, so it never reads as real data. `projection` on a played
// week (a game still in progress) draws that same dashed outline behind
// the real bar, up to where he was projected to finish.
export interface WeeklyBarDatum {
  week: number;
  kind: "played" | "dnp" | "bye" | "projected";
  values: number[];
  projection?: number | undefined;
}

// A projected column: gray dashed edge over a faint gray fill, mixed onto
// the surface like the glass marks so the average line doesn't show through.
const PROJECTED_PAINT = {
  fill: `color-mix(in srgb, ${NEUTRAL_MARK} 14%, ${SURFACE})`,
  stroke: NEUTRAL_MARK,
  strokeWidth: 1,
  strokeDasharray: "3 2",
};

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
// drawn as a muted stub rather than an empty hole. With `visibleWeeks`,
// a longer season scrolls sideways under a pinned y-axis, opening on its
// latest week (far right).
export function WeeklyBars({
  data,
  series,
  max,
  height = 96,
  reference,
  barLabel,
  readout,
  visibleWeeks,
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
  // Show at most this many weeks at once; the rest scroll sideways.
  visibleWeeks?: number | undefined;
  ariaLabel: string;
}) {
  const { ref, width } = useElementSize();
  const [active, setActive] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Whether there's more season off either edge - drives the edge fades
  // that say "this scrolls".
  const [edges, setEdges] = useState({ left: false, right: false });

  const totals = data.map((datum) => datum.values.reduce((sum, value) => sum + value, 0));
  const hasProjected = data.some(
    (datum) => datum.kind === "projected" || datum.projection !== undefined,
  );
  const top =
    max ??
    Math.max(
      1,
      ...totals,
      ...data.map((datum) => datum.projection ?? 0),
      reference?.value ?? 0,
    );
  const ticks = niceTicks(top);
  const domainTop = Math.max(top, ticks[ticks.length - 1] ?? top);

  // Bar labels need headroom over the tallest bar.
  const marginTop = barLabel ? MARGIN.top + 12 : MARGIN.top;
  const viewportWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const plotHeight = height - marginTop - MARGIN.bottom;
  const scrolls = visibleWeeks !== undefined && data.length > visibleWeeks;
  const visible = scrolls ? visibleWeeks : data.length;
  const slot = visible > 0 ? viewportWidth / visible : 0;
  const plotWidth = slot * data.length;
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

  const updateEdges = () => {
    const element = scrollRef.current;
    if (!element) return;
    const left = element.scrollLeft > 1;
    const right = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
    setEdges((current) =>
      current.left === left && current.right === right ? current : { left, right },
    );
  };

  // Open on the latest week - once per season of data, not on every render
  // (a live refresh shouldn't yank the view back after a scroll).
  const openedFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const key = `${data.length}:${data[0]?.week ?? ""}`;
    if (!element || !scrolls || plotWidth === 0 || openedFor.current === key) return;
    openedFor.current = key;
    element.scrollLeft = element.scrollWidth;
    updateEdges();
  });

  // Keep an arrow-keyed week in view.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !scrolls || active === null) return;
    const start = slot * active;
    if (start < element.scrollLeft) element.scrollLeft = start;
    else if (start + slot > element.scrollLeft + element.clientWidth) {
      element.scrollLeft = start + slot - element.clientWidth;
    }
  }, [active, scrolls, slot]);

  // Edge fades where more season is hidden - the cue that this scrolls.
  const fade = 16;
  const mask = scrolls
    ? `linear-gradient(to right, ${edges.left ? "transparent" : "#000"} 0, #000 ${fade}px, ` +
      `#000 calc(100% - ${fade}px), ${edges.right ? "transparent" : "#000"} 100%)`
    : undefined;

  return (
    <div className={classes.chart}>
      {readout && (
        <div className={classes.readout} aria-live="polite">
          {readout(activeDatum)}
        </div>
      )}
      <div ref={ref}>
        {width > 0 && (
          <div style={{ display: "flex" }}>
            {/* The y-axis stays put while the weeks scroll. */}
            <svg className={classes.svg} width={MARGIN.left} height={height} aria-hidden>
              {ticks.map((tick) => (
                <text
                  key={tick}
                  className={classes.axisText}
                  x={MARGIN.left - 6}
                  y={y(tick)}
                  textAnchor="end"
                  dominantBaseline="middle"
                >
                  {tick}
                </text>
              ))}
            </svg>
            <div
              ref={scrollRef}
              className={scrolls ? classes.scrollArea : undefined}
              style={{
                width: viewportWidth,
                ...(mask ? { maskImage: mask, WebkitMaskImage: mask } : {}),
              }}
              onScroll={updateEdges}
            >
              <svg
                className={classes.svg}
                width={plotWidth}
                height={height}
                role="img"
                aria-label={ariaLabel}
                style={scrolls ? { touchAction: "pan-x pan-y" } : undefined}
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
                  <line
                    key={tick}
                    x1={0}
                    x2={plotWidth}
                    y1={y(tick)}
                    y2={y(tick)}
                    stroke={GRID}
                    strokeWidth={1}
                  />
                ))}

                {/* Behind the bars, so it never cuts through a bar or its label. */}
                {reference && (
                  <line
                    x1={0}
                    x2={plotWidth}
                    y1={y(reference.value)}
                    y2={y(reference.value)}
                    stroke={TEXT.secondary}
                    strokeWidth={1.5}
                    pointerEvents="none"
                  />
                )}

                {data.map((datum, index) => {
                  const cx = slot * index + slot / 2;
                  const x = cx - barWidth / 2;
                  const dimmed = active !== null && active !== index;
                  let stackTop = baseline;
                  const lastFilled = datum.values.reduce(
                    (last, value, valueIndex) => (value > 0 ? valueIndex : last),
                    -1,
                  );
                  const projectedHeight =
                    ((datum.kind === "projected" ? (totals[index] ?? 0) : (datum.projection ?? 0)) /
                      domainTop) *
                    plotHeight;
                  return (
                    <g key={datum.week} opacity={dimmed ? 0.4 : 1}>
                      {(datum.kind === "projected" || datum.projection !== undefined) &&
                        projectedHeight > 0 && (
                        <path
                          d={topRoundedRect(
                            x + 0.5,
                            baseline - projectedHeight + 0.5,
                            barWidth - 1,
                            Math.max(0, projectedHeight - 1),
                            END_RADIUS,
                          )}
                          {...PROJECTED_PAINT}
                        />
                      )}
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
                          const paint = markPaint(series[valueIndex]);
                          // A glass edge is drawn inside the mark, not over the
                          // 2px gap - inset by half its width.
                          const inset = paint.strokeWidth ? paint.strokeWidth / 2 : 0;
                          return valueIndex === lastFilled ? (
                            <path
                              key={valueIndex}
                              d={topRoundedRect(
                                x + inset,
                                segmentTop + inset,
                                barWidth - inset * 2,
                                Math.max(0, segmentHeight - inset * 2),
                                END_RADIUS,
                              )}
                              {...paint}
                            />
                          ) : (
                            <rect
                              key={valueIndex}
                              x={x + inset}
                              y={segmentTop + inset}
                              width={barWidth - inset * 2}
                              height={Math.max(0, segmentHeight - inset * 2)}
                              {...paint}
                            />
                          );
                        })}
                      {barLabel &&
                        (datum.kind === "played" || datum.kind === "projected") &&
                        totals[index] !== undefined && (
                        <text
                          className={classes.columnLabel}
                          style={datum.kind === "projected" ? { fill: TEXT.muted } : undefined}
                          x={cx}
                          // Right over the real bar - inside a live bar's
                          // dashed projection, so it can't be read as the
                          // projection's number.
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
                          x={slot * index}
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
            </div>
          </div>
        )}
      </div>
      {(series.length > 1 || reference || hasProjected) && (
        <div className={classes.legend}>
          {series.length > 1 &&
            series.map((entry) => (
              <span key={entry.key} className={classes.legendItem}>
                <span className={classes.swatch} style={swatchStyle(entry)} />
                {entry.label}
              </span>
            ))}
          {reference && (
            <span className={classes.legendItem}>
              <span className={classes.swatchLine} style={{ background: TEXT.secondary }} />
              {reference.label}
            </span>
          )}
          {hasProjected && (
            <span className={classes.legendItem}>
              <span
                className={classes.swatch}
                style={{ background: PROJECTED_PAINT.fill, border: `1px dashed ${NEUTRAL_MARK}` }}
              />
              Proj.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
