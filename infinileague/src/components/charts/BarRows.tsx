import { NEGATIVE, POSITIVE, TEXT } from "./chartTheme";
import classes from "./charts.module.css";

// Share of the track a bar may fill - the rest stays free for the value
// label at its tip (and the marker's value after it), so a label is never
// clipped by the card edge.
const VALUE_TRACK = 0.5;
// Each arm of a diverging row, as a share of the whole track.
const DIVERGING_ARM = 0.34;

export interface ValueBarRow {
  key: string | number;
  label: string;
  value: number;
  valueText: string;
  // A comparison mark on the same scale (the market's value) - a tick, so
  // "ours vs. theirs" reads as the gap between the bar's end and the tick.
  marker?: number | undefined;
  markerText?: string | undefined;
}

// Horizontal bars on one shared scale, value at each tip, with an optional
// tick per row for a second number on the same scale. Replaces side-by-side
// columns of values ("Mkt 4,210 · Infini 5,030 · Avg 4,620"): the bar is
// ours, the tick is the market's, and the gap is the story.
export function ValueBars({
  rows,
  max,
  color,
  barLabel,
  markerLabel,
}: {
  rows: ValueBarRow[];
  // Shared scale top - defaults to the largest bar or marker.
  max?: number;
  color: string;
  // Legend names for the bar and the tick.
  barLabel: string;
  markerLabel?: string;
}) {
  const top = max ?? Math.max(1, ...rows.flatMap((row) => [row.value, row.marker ?? 0]));
  const pct = (value: number) => `${(Math.max(value, 0) / top) * VALUE_TRACK * 100}%`;
  return (
    <div className={classes.chart}>
      <div className={classes.barRows}>
        {rows.map((row) => (
          <div
            key={row.key}
            className={classes.barRow}
            role="img"
            aria-label={
              `${row.label}: ${barLabel} ${row.valueText}` +
              (row.markerText ? `, ${markerLabel ?? "marker"} ${row.markerText}` : "")
            }
          >
            <span className={classes.barLabel} aria-hidden>
              {row.label}
            </span>
            <div className={classes.barTrack} aria-hidden>
              <div
                className={`${classes.bar} ${classes.barEndRight}`}
                style={{ left: 0, width: pct(row.value), background: color }}
              />
              {row.marker !== undefined && (
                <div className={classes.barMarker} style={{ left: pct(row.marker) }} />
              )}
              <span
                className={classes.barValue}
                style={{
                  left: `calc(${pct(Math.max(row.value, row.marker ?? 0))} + 7px)`,
                }}
              >
                {row.valueText}
                {row.markerText && (
                  <span style={{ color: TEXT.muted, fontWeight: 500 }}>
                    {` · ${markerLabel ?? "vs."} ${row.markerText}`}
                  </span>
                )}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className={classes.legend}>
        <span className={classes.legendItem}>
          <span className={classes.swatch} style={{ background: color }} />
          {barLabel}
        </span>
        {markerLabel && (
          <span className={classes.legendItem}>
            <span
              className={classes.swatchLine}
              style={{ width: 2, height: 12, background: TEXT.primary }}
            />
            {markerLabel}
          </span>
        )}
      </div>
    </div>
  );
}

export interface DivergingBarRow {
  key: string | number;
  label: string;
  value: number;
  // Signed, e.g. "+2.1 pts/wk".
  valueText: string;
}

// Signed values from a shared zero line - gains right in blue, losses left
// in red - so "who wins this trade" is the bars' lengths and directions
// rather than four signed numbers to compare.
export function DivergingBars({
  rows,
  maxAbs,
}: {
  rows: DivergingBarRow[];
  maxAbs?: number;
}) {
  const top = maxAbs ?? Math.max(1e-9, ...rows.map((row) => Math.abs(row.value)));
  const arm = (value: number) => (Math.min(Math.abs(value), top) / top) * DIVERGING_ARM * 100;
  return (
    <div className={classes.barRows}>
      {rows.map((row) => {
        const width = arm(row.value);
        const positive = row.value >= 0;
        return (
          <div
            key={row.key}
            className={classes.barRow}
            role="img"
            aria-label={`${row.label}: ${row.valueText}`}
          >
            <span className={classes.barLabel} aria-hidden>
              {row.label}
            </span>
            <div className={classes.barTrack} aria-hidden>
              <div className={classes.barZero} style={{ left: "50%" }} />
              <div
                className={`${classes.bar} ${positive ? classes.barEndRight : classes.barEndLeft}`}
                style={{
                  left: positive ? "50%" : `${50 - width}%`,
                  width: `${width}%`,
                  background: positive ? POSITIVE : NEGATIVE,
                }}
              />
              <span
                className={classes.barValue}
                style={
                  positive
                    ? { left: `calc(${50 + width}% + 6px)` }
                    : { right: `calc(${50 + width}% + 6px)` }
                }
              >
                {row.valueText}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
