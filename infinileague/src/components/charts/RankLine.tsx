import { useElementSize } from "@mantine/hooks";
import { GRID, NEUTRAL_MARK, SURFACE } from "./chartTheme";
import classes from "./charts.module.css";

export interface RankLineSeries {
  key: string;
  label: string;
  color: string;
  // One rank per week (1 = best), aligned with `weeks`; null where he has
  // no rank that week - the line breaks there.
  ranks: Array<number | null>;
}

const BASE_MARGIN = { top: 8, right: 40, bottom: 18, left: 34 };
// With a label on every point: room above the top point for its label, and
// only half a label's width at the right (no end label there).
const LABELED_MARGIN = { ...BASE_MARGIN, top: 20, right: 18 };
const END_DOT = 4;
const POINT_DOT = 3;

// Rank over the season as lines - week across, rank down (1 at the top),
// on the same tier bands as RankDumbbell ("WR1" = ranks 1-12, ...), so a
// climb or slide reads as moving between tiers. Each line's latest rank is
// labeled at its end. The axis zooms to the tiers his ranks actually reach
// (at least two, never past `maxRank`), so a WR who's lived in WR1-WR2 all
// season shows his movement instead of a flat line at the top of a 72-deep
// axis. Ranks past the axis pin to the bottom edge (their label still says
// the real number). `pointLabels` labels every week's point ("RB16")
// instead of just the end.
export function RankLine({
  weeks,
  series,
  position,
  maxRank,
  tierSize = 12,
  height = 170,
  pointLabels = false,
  reference,
  ariaLabel,
}: {
  weeks: number[];
  series: RankLineSeries[];
  position: string;
  maxRank: number;
  tierSize?: number;
  height?: number;
  pointLabels?: boolean;
  // A flat dashed line at one rank across the whole chart - e.g. where
  // he's projected to rank the rest of the season - named in the legend.
  reference?: { rank: number; label: string } | undefined;
  ariaLabel: string;
}) {
  const MARGIN = pointLabels ? LABELED_MARGIN : BASE_MARGIN;
  const { ref, width } = useElementSize();
  const worst = Math.max(
    1,
    ...series.flatMap((entry) => entry.ranks.filter((rank): rank is number => rank !== null)),
    reference?.rank ?? 1,
  );
  const axisMax = Math.min(maxRank, Math.max(tierSize * 2, Math.ceil(worst / tierSize) * tierSize));
  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const plotHeight = height - MARGIN.top - MARGIN.bottom;
  const x = (index: number) =>
    MARGIN.left + (weeks.length > 1 ? (index / (weeks.length - 1)) * plotWidth : plotWidth / 2);
  const y = (rank: number) =>
    MARGIN.top + ((Math.min(rank, axisMax) - 1) / Math.max(axisMax - 1, 1)) * plotHeight;
  const tiers = Math.ceil(axisMax / tierSize);
  const labelEvery = weeks.length > 12 ? 2 : 1;

  // Latest ranked point per series, for the end dot and label.
  const ends = series.map((entry) => {
    for (let index = entry.ranks.length - 1; index >= 0; index -= 1) {
      const rank = entry.ranks[index];
      if (rank !== null && rank !== undefined) return { index, rank };
    }
    return null;
  });
  // Nudge end labels apart when two lines finish close together.
  const labelY = ends.map((end) => (end ? y(end.rank) : 0));
  if (labelY.length === 2 && ends[0] && ends[1] && Math.abs(labelY[0]! - labelY[1]!) < 12) {
    const upper = labelY[0]! <= labelY[1]! ? 0 : 1;
    const middle = (labelY[0]! + labelY[1]!) / 2;
    labelY[upper] = middle - 6;
    labelY[1 - upper] = middle + 6;
  }

  return (
    <div className={classes.chart}>
      <div ref={ref}>
        {width > 0 ? (
          <svg
            className={classes.svg}
            width={width}
            height={height}
            role="img"
            aria-label={ariaLabel}
          >
            {Array.from({ length: tiers }, (_, tier) => {
              const top = y(tier * tierSize + 1);
              const bottom = y(Math.min((tier + 1) * tierSize, axisMax));
              return (
                <g key={tier}>
                  {tier % 2 === 0 && (
                    <rect
                      x={MARGIN.left}
                      y={top - 3}
                      width={plotWidth}
                      height={bottom - top + 6}
                      rx={4}
                      fill="rgba(255, 255, 255, 0.035)"
                    />
                  )}
                  <text
                    className={classes.axisText}
                    x={MARGIN.left - 8}
                    y={(top + bottom) / 2}
                    textAnchor="end"
                    dominantBaseline="middle"
                  >
                    {`${position}${tier + 1}`}
                  </text>
                </g>
              );
            })}
            <line
              x1={MARGIN.left}
              x2={MARGIN.left + plotWidth}
              y1={height - MARGIN.bottom + 2}
              y2={height - MARGIN.bottom + 2}
              stroke={GRID}
            />
            {weeks.map((week, index) =>
              index % labelEvery === 0 || index === weeks.length - 1 ? (
                <text
                  key={week}
                  className={classes.axisText}
                  x={x(index)}
                  y={height - 3}
                  textAnchor="middle"
                >
                  {week}
                </text>
              ) : null,
            )}

            {/* Behind the lines - a projection, so dashed like the bar
                charts' projected weeks. */}
            {reference && (
              <line
                x1={MARGIN.left}
                x2={MARGIN.left + plotWidth}
                y1={y(reference.rank)}
                y2={y(reference.rank)}
                stroke={NEUTRAL_MARK}
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            )}

            {series.map((entry) => {
              // One path per unbroken run of ranked weeks.
              const runs: string[] = [];
              let current: string[] = [];
              entry.ranks.forEach((rank, index) => {
                if (rank === null) {
                  if (current.length > 1) runs.push(current.join(" "));
                  current = [];
                  return;
                }
                current.push(`${current.length === 0 ? "M" : "L"}${x(index)},${y(rank)}`);
              });
              if (current.length > 1) runs.push(current.join(" "));
              return (
                <g key={entry.key}>
                  {runs.map((d) => (
                    <path
                      key={d}
                      d={d}
                      fill="none"
                      stroke={entry.color}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                </g>
              );
            })}

            {pointLabels &&
              series.map((entry, seriesIndex) =>
                entry.ranks.map((rank, index) =>
                  rank === null || index === ends[seriesIndex]?.index ? null : (
                    <circle
                      key={`${entry.key}-${index}`}
                      cx={x(index)}
                      cy={y(rank)}
                      r={POINT_DOT}
                      fill={entry.color}
                      stroke={SURFACE}
                      strokeWidth={1.5}
                    />
                  ),
                ),
              )}
            {pointLabels &&
              series.map((entry) =>
                entry.ranks.map((rank, index) =>
                  rank === null ? null : (
                    <text
                      key={`${entry.key}-label-${index}`}
                      className={classes.columnLabel}
                      x={x(index)}
                      y={y(rank) - 8}
                      textAnchor="middle"
                      // A surface-colored halo so the line passing behind
                      // never cuts through the label.
                      style={{ paintOrder: "stroke", stroke: SURFACE, strokeWidth: 3 }}
                    >
                      {`${position}${rank}`}
                    </text>
                  ),
                ),
              )}

            {series.map((entry, seriesIndex) => {
              const end = ends[seriesIndex];
              if (!end) return null;
              return (
                <g key={entry.key}>
                  <circle
                    cx={x(end.index)}
                    cy={y(end.rank)}
                    r={END_DOT}
                    fill={entry.color}
                    stroke={SURFACE}
                    strokeWidth={2}
                  />
                  {!pointLabels && (
                    <text
                      className={classes.markLabel}
                      x={x(end.index) + 9}
                      y={labelY[seriesIndex]}
                      dominantBaseline="middle"
                    >
                      {`${position}${end.rank}`}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        ) : (
          <div style={{ height }} />
        )}
      </div>
      {(series.length > 1 || reference) && (
        <div className={classes.legend}>
          {series.length > 1 &&
            series.map((entry) => (
              <span key={entry.key} className={classes.legendItem}>
                <span className={classes.swatchLine} style={{ background: entry.color }} />
                {entry.label}
              </span>
            ))}
          {reference && (
            <span className={classes.legendItem}>
              <span
                className={classes.swatchLine}
                style={{
                  width: 14,
                  height: 0,
                  borderRadius: 0,
                  background: "none",
                  borderTop: `2px dashed ${NEUTRAL_MARK}`,
                }}
              />
              {reference.label}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
