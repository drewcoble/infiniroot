import type { CSSProperties } from "react";
import { injuryColor } from "@shared/injuryColor";
import { positionColorOrDefault, type Position } from "@shared/positionColors";
import classes from "./GlassMatchupCard.module.css";

// Where this player's game is this week - drives the card's emphasis and
// which projection it shows (pregame vs. live), same states the current
// Matchup tab derives from lib/liveGames.ts.
export type GameState = "pre" | "live" | "final" | "bye";

export interface GlassMatchupCardData {
  name: string;
  position: Position;
  positionRank: number;
  team: string;
  // "@ BUF · Sun 4:25 PM" / "vs. LAR · Q3 8:12" - formatGameLine's output.
  gameLine: string;
  gameState: GameState;
  projectedPoints?: number;
  // Live projection (points so far + unplayed share of the projection) -
  // only read while gameState is "live".
  liveProjectedPoints?: number;
  actualPoints?: number;
  injury?: { status: string; statusShort: string };
  // Not shown on the base card - reserved for the expanded detail card.
  isRookie?: boolean;
}

// Each pill is a small glass pane tinted by its theme color (--pill-tint,
// see .pill). The pane carries the color; text stays near-white with just a
// hint of it, since a full light shade over its own tint read too faintly.
function pillStyle(color: string) {
  return {
    color: `color-mix(in srgb, var(--mantine-color-${color}-1) 30%, #fff)`,
    "--pill-tint": `var(--mantine-color-${color}-4)`,
  } as CSSProperties;
}

function formatPoints(points: number | undefined): string {
  return points === undefined ? "—" : points.toFixed(2);
}

function formatProj(points: number | undefined): string {
  return points === undefined ? "—" : points.toFixed(1);
}

// Screen readers get one sentence instead of hopping through every pill
// and number in visual order.
function ariaSummary(data: GlassMatchupCardData): string {
  const parts = [
    data.name,
    `${data.position}${data.positionRank > 0 ? ` ${data.positionRank}` : ""}`,
    `${data.team} ${data.gameLine}`,
  ];
  if (data.gameState === "live") parts.push("game in progress");
  if (data.injury) parts.push(data.injury.status);
  parts.push(`${formatPoints(data.actualPoints)} points`);
  parts.push(`projected ${formatProj(data.projectedPoints)}`);
  if (data.gameState === "live") {
    const pace = paceVsProjection(data.projectedPoints, data.liveProjectedPoints);
    const paceText =
      pace === "ahead" ? ", ahead of projection" : pace === "behind" ? ", behind projection" : "";
    parts.push(`on pace for ${formatProj(data.liveProjectedPoints)}${paceText}`);
  }
  if (data.gameState === "final") {
    const pace = paceVsProjection(data.projectedPoints, data.actualPoints);
    if (pace === "ahead") parts.push("beat projection");
    if (pace === "behind") parts.push("fell short of projection");
  }
  return parts.join(", ");
}

// How far the live projection can drift from the pregame one and still
// count as "on projection" - relative rather than a flat point count, since
// 2 points is noise for a 24-point QB but a big swing for an 8-point kicker.
// The floor keeps tiny projections from flipping on a single point.
const PACE_BUFFER_SHARE = 0.1;
const PACE_BUFFER_MIN = 1;

type Pace = "ahead" | "even" | "behind";

function paceVsProjection(
  projected: number | undefined,
  liveProjected: number | undefined,
): Pace | undefined {
  if (projected === undefined || liveProjected === undefined) return undefined;
  const buffer = Math.max(projected * PACE_BUFFER_SHARE, PACE_BUFFER_MIN);
  if (liveProjected > projected + buffer) return "ahead";
  if (liveProjected < projected - buffer) return "behind";
  return "even";
}

// Bullet meter under the points: fill = actual points, tick = pregame
// projection, and mid-game a faint extension from actual out to the live
// projection (where they're on pace to finish), colored by pace vs. the
// pregame projection - green ahead, red behind, neutral within the buffer.
// Final games color the fill instead, by the final score vs. projection.
// `scaleMax` is shared by every card on the page so bar lengths compare
// across cards and rows - see meterScale.ts.
function PointsMeter({
  actual,
  projected,
  liveProjected,
  isFinal,
  scaleMax,
}: {
  actual: number;
  projected: number | undefined;
  liveProjected: number | undefined;
  isFinal: boolean;
  scaleMax: number;
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
    <div className={classes.meter} aria-hidden>
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

// Base (collapsed) Matchup card - name, position, this week's game, and
// the two numbers a matchup is about: actual points large, with projection
// (and live projection mid-game) drawn on a meter under it. A live game
// shows as the card's green tint plus a pulsing dot on the game clock.
// Long-press expansion into a detail card comes later; it's focusable now
// so that interaction has a keyboard counterpart from the start.
export function GlassMatchupCard({
  data,
  displayName = data.name,
  scaleMax,
}: {
  data: GlassMatchupCardData;
  displayName?: string;
  scaleMax: number;
}) {
  const isLive = data.gameState === "live";
  const isBye = data.gameState === "bye";
  const isPre = data.gameState === "pre";
  const positionColor = positionColorOrDefault(data.position);

  return (
    <div
      className={[classes.card, isLive && classes.live, isBye && classes.muted]
        .filter(Boolean)
        .join(" ")}
      tabIndex={0}
      role="group"
      aria-label={ariaSummary(data)}
    >
      <div className={classes.topRow} aria-hidden>
        <div className={classes.pills}>
          <span className={classes.pill} style={pillStyle(positionColor)}>
            {data.position}
            {data.positionRank > 0 ? data.positionRank : ""}
          </span>
          {data.injury && (
            <span
              className={classes.pill}
              style={pillStyle(injuryColor(data.injury.status))}
              title={data.injury.status}
            >
              {data.injury.statusShort}
            </span>
          )}
        </div>
      </div>

      <div aria-hidden>
        <div className={classes.name}>{displayName}</div>
        <div className={classes.gameLine}>
          {isLive && <span className={classes.dot} />}
          {data.gameLine}
        </div>
      </div>

      {/* Before kickoff the actual score is a meaningless 0, so the number
          slot shows the projection instead (dimmed and labeled); once the
          game starts it's the actual score, and the projection lives on
          the meter's tick. */}
      <div className={classes.statsRow} aria-hidden>
        {isBye ? (
          <span className={classes.points}>—</span>
        ) : isPre ? (
          <>
            <span className={`${classes.points} ${classes.pointsPending}`}>
              {formatProj(data.projectedPoints)}
            </span>
            <span className={classes.pointsUnit}>proj</span>
          </>
        ) : (
          <span className={classes.points}>{formatPoints(data.actualPoints)}</span>
        )}
      </div>
      {!isBye && (
        <PointsMeter
          actual={data.actualPoints ?? 0}
          projected={data.projectedPoints}
          liveProjected={isLive ? data.liveProjectedPoints : undefined}
          isFinal={data.gameState === "final"}
          scaleMax={scaleMax}
        />
      )}
    </div>
  );
}

export function EmptyGlassCard() {
  return (
    <div className={`${classes.card} ${classes.empty}`} aria-label="Empty slot" role="group">
      <span style={{ fontSize: 12 }}>Empty</span>
    </div>
  );
}

export function GlassSlotChip({ label }: { label: string }) {
  return (
    <span
      className={`${classes.pill} ${classes.slotChip}`}
      style={pillStyle(positionColorOrDefault(label))}
    >
      {label}
    </span>
  );
}
