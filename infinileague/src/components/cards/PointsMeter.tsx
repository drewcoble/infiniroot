import {
  formatPoints,
  formatProj,
  paceVsProjection,
  type GlassMatchupCardData,
} from "./cardShared";
import classes from "./GlassMatchupCard.module.css";

// Bullet meter under the points: fill = actual points, tick = pregame
// projection, and mid-game a faint extension from actual out to the live
// projection (where they're on pace to finish), colored by pace vs. the
// pregame projection - green ahead, red behind, neutral within the buffer.
// Final games color the fill instead, by the final score vs. projection.
// `scaleMax` is shared by every card on the page so bar lengths compare
// across cards and rows - see meterScale.ts. `large` is the detail card's
// taller version of the same meter.
export function PointsMeter({
  actual,
  projected,
  liveProjected,
  isFinal,
  scaleMax,
  large = false,
}: {
  actual: number;
  projected: number | undefined;
  liveProjected: number | undefined;
  isFinal: boolean;
  scaleMax: number;
  large?: boolean;
}) {
  const pace = paceVsProjection(projected, liveProjected);
  // Once the game's over the fill itself takes the pace color, against the
  // final score rather than a live projection - fainter than the live
  // extension so a settled result doesn't compete with games still going.
  const finalPace = isFinal ? paceVsProjection(projected, actual) : undefined;
  const pct = (value: number) => `${Math.min(Math.max(value / scaleMax, 0), 1) * 100}%`;
  const ghostEnd =
    liveProjected !== undefined && liveProjected > actual ? liveProjected : undefined;
  return (
    <div
      className={[classes.meter, large && classes.meterLarge].filter(Boolean).join(" ")}
      aria-hidden
    >
      {ghostEnd !== undefined && (
        <div
          className={`${classes.meterGhost} ${pace ? classes[`pace_${pace}`] : ""}`}
          style={{
            left: pct(actual),
            width: `calc(${pct(ghostEnd)} - ${pct(actual)})`,
          }}
        />
      )}
      {actual > 0 && (
        <div
          className={[classes.meterFill, finalPace && classes[`final_${finalPace}`]]
            .filter(Boolean)
            .join(" ")}
          style={{ width: pct(actual) }}
        />
      )}
      {projected !== undefined && (
        <div className={classes.meterTick} style={{ left: pct(projected) }} />
      )}
    </div>
  );
}

// The card's headline number: the actual score, large, once the game has
// started (the projection lives on the meter's tick). Before kickoff there's
// no score yet, so it's just the projection, small - big text is saved for
// points actually scored.
export function PointsHeadline({ data }: { data: GlassMatchupCardData }) {
  if (data.gameState === "bye") return <span className={classes.points}>—</span>;
  if (data.gameState === "pre") {
    return <span className={classes.projSmall}>Proj {formatProj(data.projectedPoints)}</span>;
  }
  return <span className={classes.points}>{formatPoints(data.actualPoints)}</span>;
}
