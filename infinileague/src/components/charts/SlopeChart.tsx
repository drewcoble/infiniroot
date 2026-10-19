import { useElementSize } from "@mantine/hooks";
import { GRID, SERIES, SURFACE, TEXT } from "./chartTheme";
import classes from "./charts.module.css";

export interface SlopeRow {
  key: string;
  name: string;
  before: number;
  after: number;
}

const ROW = 20;
const TOP = 18;
const RANK_COLUMN = 22;

// Every team's rank before and after (a trade), one line each - the
// highlighted teams (the two in the trade) in series colors with their
// names, everyone else a faint gray line, so the league-wide ripple is
// visible without reading a 12-row table. Ranks are 1 at the top.
export function SlopeChart({
  rows,
  highlight,
  beforeLabel,
  afterLabel,
}: {
  rows: SlopeRow[];
  // Up to SERIES.length team keys, in color-slot order.
  highlight: string[];
  beforeLabel: string;
  afterLabel: string;
}) {
  const { ref, width } = useElementSize();
  const count = rows.length;
  const height = TOP + count * ROW;
  const left = RANK_COLUMN + 8;
  // Room on the right for the highlighted teams' names.
  const right = Math.max(left + 60, width * 0.42);
  const y = (rank: number) => TOP + (rank - 0.5) * ROW;
  const colorOf = (key: string) => {
    const slot = highlight.indexOf(key);
    return slot >= 0 ? SERIES[slot] : undefined;
  };
  // Gray lines first, highlighted ones on top.
  const isHighlighted = (row: SlopeRow) => Number(colorOf(row.key) !== undefined);
  const ordered = [...rows].sort((a, b) => isHighlighted(a) - isHighlighted(b));

  const describe = rows
    .filter((row) => colorOf(row.key))
    .map((row) => `${row.name} #${row.before} to #${row.after}`)
    .join("; ");

  return (
    <div className={classes.chart}>
      <div ref={ref}>
        {width > 0 && (
          <svg
            className={classes.svg}
            width={width}
            height={height}
            role="img"
            aria-label={describe}
          >
            <text className={classes.axisText} x={left} y={10} textAnchor="middle">
              {beforeLabel}
            </text>
            <text className={classes.axisText} x={right} y={10} textAnchor="middle">
              {afterLabel}
            </text>
            <line x1={left} x2={left} y1={TOP} y2={height} stroke={GRID} />
            <line x1={right} x2={right} y1={TOP} y2={height} stroke={GRID} />
            {Array.from({ length: count }, (_, index) => (
              <text
                key={index}
                className={classes.axisText}
                x={RANK_COLUMN}
                y={y(index + 1)}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {index + 1}
              </text>
            ))}
            {ordered.map((row) => {
              const color = colorOf(row.key);
              return (
                <g key={row.key}>
                  <line
                    x1={left}
                    x2={right}
                    y1={y(row.before)}
                    y2={y(row.after)}
                    stroke={color ?? "rgba(255, 255, 255, 0.18)"}
                    strokeWidth={color ? 2 : 1}
                    strokeLinecap="round"
                  />
                  {color && (
                    <>
                      <circle
                        cx={left}
                        cy={y(row.before)}
                        r={4}
                        fill={color}
                        stroke={SURFACE}
                        strokeWidth={2}
                      />
                      <circle
                        cx={right}
                        cy={y(row.after)}
                        r={4}
                        fill={color}
                        stroke={SURFACE}
                        strokeWidth={2}
                      />
                      <text
                        className={classes.markLabel}
                        x={right + 10}
                        y={y(row.after)}
                        dominantBaseline="middle"
                      >
                        {`#${row.after} ${row.name}`}
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
        {rows
          .filter((row) => colorOf(row.key))
          .sort((a, b) => highlight.indexOf(a.key) - highlight.indexOf(b.key))
          .map((row) => (
            <span key={row.key} className={classes.legendItem}>
              <span className={classes.swatchLine} style={{ background: colorOf(row.key) }} />
              {row.name}
            </span>
          ))}
        <span className={classes.legendItem}>
          <span className={classes.swatchLine} style={{ background: TEXT.muted }} />
          Rest of the league
        </span>
      </div>
    </div>
  );
}
