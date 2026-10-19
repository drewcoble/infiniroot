import classes from "./charts.module.css";

// A fixed row of labeled steps, filled up to the current one - for ordinal
// reads like an injury's availability or timeline, where "2.31 / 4" means
// nothing at a glance but "3 of 5 steps toward Out" does. `confidence`
// fades the fill (a shaky read looks shaky) and is spelled out beside the
// value, so it never rests on opacity alone.
export function SegmentGauge({
  title,
  steps,
  level,
  color,
  confidence,
}: {
  title: string;
  // Step names, low to high. Only the two ends are printed under the bar.
  steps: string[];
  // Index of the current step.
  level: number;
  color: string;
  // 0-1.
  confidence?: number | undefined;
}) {
  const current = steps[level] ?? "—";
  const opacity = confidence === undefined ? 1 : 0.45 + 0.55 * confidence;
  const columns = `repeat(${steps.length}, minmax(0, 1fr))`;
  return (
    <div
      className={classes.gauge}
      role="img"
      aria-label={
        `${title}: ${current}, step ${level + 1} of ${steps.length}` +
        (confidence !== undefined ? `, ${Math.round(confidence * 100)}% confident` : "")
      }
    >
      <div className={classes.gaugeHead} aria-hidden>
        <span className={classes.gaugeTitle}>{title}</span>
        <span>
          <span className={classes.gaugeValue}>{current}</span>
          {confidence !== undefined && (
            <span className={classes.gaugeTitle}>
              {` · ${Math.round(confidence * 100)}% sure`}
            </span>
          )}
        </span>
      </div>
      <div className={classes.gaugeSteps} style={{ gridTemplateColumns: columns }} aria-hidden>
        {steps.map((step, index) => (
          <span
            key={step}
            className={classes.gaugeStep}
            style={index <= level ? { background: color, opacity } : undefined}
          />
        ))}
      </div>
      <div
        className={classes.gaugeScale}
        style={{ gridTemplateColumns: "1fr 1fr" }}
        aria-hidden
      >
        <span>{steps[0]}</span>
        <span>{steps[steps.length - 1]}</span>
      </div>
    </div>
  );
}
