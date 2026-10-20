import { SURFACE } from "./chartTheme";
import classes from "./charts.module.css";

// Tiny trend line for a list row - no axes, just the shape, with the latest
// value as an end dot. `null` entries (byes, missed games) break the line
// rather than drawing a dip to zero. `invert` puts low values on top - for
// ranks, where 1 is best.
export function Sparkline({
  values,
  color,
  width = 72,
  height = 24,
  min,
  max,
  invert = false,
  ariaLabel,
}: {
  values: Array<number | null>;
  color: string;
  width?: number;
  height?: number;
  min?: number;
  max?: number;
  invert?: boolean;
  ariaLabel: string;
}) {
  const present = values.filter((value): value is number => value !== null);
  const low = min ?? Math.min(...present);
  const high = max ?? Math.max(...present);
  const span = high - low || 1;
  // Room for the end dot (r=4) plus its 2px ring.
  const pad = 6;
  const x = (index: number) =>
    values.length > 1 ? pad + (index / (values.length - 1)) * (width - pad * 2) : width / 2;
  const y = (value: number) => {
    const share = (value - low) / span;
    return pad + (invert ? share : 1 - share) * (height - pad * 2);
  };

  // One path per unbroken run of values.
  const runs: string[] = [];
  let current: string[] = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (current.length > 1) runs.push(current.join(" "));
      current = [];
      return;
    }
    current.push(`${current.length === 0 ? "M" : "L"}${x(index)},${y(value)}`);
  });
  if (current.length > 1) runs.push(current.join(" "));

  const lastIndex = values.reduce<number>(
    (last, value, index) => (value !== null ? index : last),
    -1,
  );
  const last = lastIndex >= 0 ? values[lastIndex] : null;

  return (
    <svg className={classes.svg} width={width} height={height} role="img" aria-label={ariaLabel}>
      {runs.map((d) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {last !== null && last !== undefined && (
        <circle
          cx={x(lastIndex)}
          cy={y(last)}
          r={4}
          fill={color}
          stroke={SURFACE}
          strokeWidth={2}
        />
      )}
    </svg>
  );
}
