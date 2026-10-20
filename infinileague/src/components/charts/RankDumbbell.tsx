import { useElementSize } from "@mantine/hooks";
import { GRID, NEGATIVE, POSITIVE, SURFACE, TEXT } from "./chartTheme";
import classes from "./charts.module.css";

export interface RankDumbbellRow {
  key: string | number;
  label: string;
  // Position ranks, 1 = best. 0/undefined = unranked (that dot is left out).
  from: number | undefined;
  to: number | undefined;
}

const SIDE = 10;
const HEADER = 16;
const ROW_LABEL = 15;
const ROW_DOTS = 22;
const ROW_GAP = 6;
const DOT_R = 5;

// Two ranks for the same player on one tier-banded axis - season so far
// vs. rest of season, or the market's rank vs. ours. The connecting line
// takes the move's color (blue better, red worse), so a glance says which
// way he's heading and how far, and the bands say what that means in tiers
// ("an RB2 becoming an RB1") instead of making anyone compare two numbers.
// Each dot's own label sits on its outer side, so the two never collide.
export function RankDumbbell({
  rows,
  position,
  maxRank,
  tierSize = 12,
  fromLabel,
  toLabel,
}: {
  rows: RankDumbbellRow[];
  position: string;
  // The axis's last rank - deeper ranks pin to the edge (their label still
  // says the real number).
  maxRank: number;
  tierSize?: number;
  fromLabel: string;
  toLabel: string;
}) {
  const { ref, width } = useElementSize();
  const plotWidth = Math.max(0, width - SIDE * 2);
  const x = (rank: number) =>
    SIDE + ((Math.min(rank, maxRank) - 1) / Math.max(maxRank - 1, 1)) * plotWidth;
  const rowHeight = ROW_LABEL + ROW_DOTS + ROW_GAP;
  const height = HEADER + rows.length * rowHeight;
  const tiers = Math.ceil(maxRank / tierSize);
  const rankText = (rank: number) => `${position}${rank}`;

  const describe = (row: RankDumbbellRow) => {
    if (!row.from || !row.to) return `${row.label}: unranked`;
    const move = row.from - row.to;
    return (
      `${row.label}: ${fromLabel} ${rankText(row.from)}, ${toLabel} ${rankText(row.to)}` +
      (move === 0 ? ", no change" : `, ${Math.abs(move)} spots ${move > 0 ? "better" : "worse"}`)
    );
  };

  return (
    <div className={classes.chart}>
      <div ref={ref}>
        {width > 0 && (
          <svg
            className={classes.svg}
            width={width}
            height={height}
            role="img"
            aria-label={rows.map(describe).join("; ")}
          >
            {Array.from({ length: tiers }, (_, tier) => {
              const start = x(tier * tierSize + 1);
              const end = x(Math.min((tier + 1) * tierSize, maxRank));
              return (
                <g key={tier}>
                  {tier % 2 === 0 && (
                    <rect
                      x={start - 4}
                      y={HEADER}
                      width={end - start + 8}
                      height={height - HEADER}
                      rx={4}
                      fill="rgba(255, 255, 255, 0.035)"
                    />
                  )}
                  <text
                    className={classes.axisText}
                    x={(start + end) / 2}
                    y={10}
                    textAnchor="middle"
                  >
                    {`${position}${tier + 1}`}
                  </text>
                </g>
              );
            })}

            {rows.map((row, index) => {
              const top = HEADER + index * rowHeight;
              const cy = top + ROW_LABEL + ROW_DOTS / 2;
              const from = row.from || undefined;
              const to = row.to || undefined;
              const color =
                from && to
                  ? to < from
                    ? POSITIVE
                    : to > from
                      ? NEGATIVE
                      : TEXT.secondary
                  : TEXT.secondary;
              // Which side each label goes on: away from the other dot.
              const fromLeft = from !== undefined && to !== undefined ? x(from) <= x(to) : true;
              return (
                <g key={row.key}>
                  <text className={classes.markLabelMuted} x={SIDE} y={top + 11}>
                    {row.label}
                  </text>
                  <line
                    x1={SIDE}
                    x2={width - SIDE}
                    y1={cy}
                    y2={cy}
                    stroke={GRID}
                    strokeWidth={1}
                  />
                  {from !== undefined && to !== undefined && from !== to && (
                    <line
                      x1={x(from)}
                      x2={x(to)}
                      y1={cy}
                      y2={cy}
                      stroke={color}
                      strokeWidth={2}
                      strokeLinecap="round"
                    />
                  )}
                  {from !== undefined && (
                    <>
                      <circle
                        cx={x(from)}
                        cy={cy}
                        r={DOT_R - 1}
                        fill={SURFACE}
                        stroke={TEXT.secondary}
                        strokeWidth={2}
                      />
                      {from !== to && (
                        <text
                          className={classes.markLabelMuted}
                          x={x(from) + (fromLeft ? -9 : 9)}
                          y={cy}
                          textAnchor={fromLeft ? "end" : "start"}
                          dominantBaseline="middle"
                        >
                          {rankText(from)}
                        </text>
                      )}
                    </>
                  )}
                  {to !== undefined && (
                    <>
                      <circle
                        cx={x(to)}
                        cy={cy}
                        r={DOT_R}
                        fill={color}
                        stroke={SURFACE}
                        strokeWidth={2}
                      />
                      <text
                        className={classes.markLabel}
                        x={x(to) + (fromLeft ? 9 : -9)}
                        y={cy}
                        textAnchor={fromLeft ? "start" : "end"}
                        dominantBaseline="middle"
                      >
                        {rankText(to)}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>
      <div className={classes.legend}>
        <span className={classes.legendItem}>
          <span className={classes.swatchRing} />
          {fromLabel}
        </span>
        <span className={classes.legendItem}>
          <span className={classes.swatch} style={{ background: POSITIVE, borderRadius: 999 }} />
          {toLabel}, better
        </span>
        <span className={classes.legendItem}>
          <span className={classes.swatch} style={{ background: NEGATIVE, borderRadius: 999 }} />
          {toLabel}, worse
        </span>
      </div>
    </div>
  );
}
