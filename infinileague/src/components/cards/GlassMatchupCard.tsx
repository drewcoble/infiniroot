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
  isRookie?: boolean;
}

// Each pill is a small glass pane tinted by its theme color - a light shade
// for text (the card's glass is mostly clear over the dark page), and
// --pill-tint for the pane's tint and border (see .pill).
function pillStyle(color: string) {
  return {
    color: `var(--mantine-color-${color}-2)`,
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
  if (data.isRookie) parts.push("rookie");
  parts.push(`${formatPoints(data.actualPoints)} points`);
  const proj = data.gameState === "live" ? data.liveProjectedPoints : data.projectedPoints;
  parts.push(`${data.gameState === "live" ? "live projection" : "projected"} ${formatProj(proj)}`);
  return parts.join(", ");
}

// Base (collapsed) Matchup card - name, position, this week's game, and
// the two numbers a matchup is about. Long-press expansion into a detail
// card comes later; it's focusable now so that interaction has a keyboard
// counterpart from the start.
export function GlassMatchupCard({ data }: { data: GlassMatchupCardData }) {
  const isLive = data.gameState === "live";
  const isBye = data.gameState === "bye";
  const positionColor = positionColorOrDefault(data.position);
  const proj = isLive ? data.liveProjectedPoints : data.projectedPoints;

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
          {data.isRookie && (
            <span className={classes.pill} style={pillStyle("grape")} title="Rookie">
              R
            </span>
          )}
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
        {isLive && (
          <span className={`${classes.pill} ${classes.statusLive}`}>
            <span className={classes.dot} />
            LIVE
          </span>
        )}
      </div>

      <div aria-hidden>
        <div className={classes.name}>{data.name}</div>
        <div className={classes.gameLine}>
          {data.team} · {data.gameLine}
        </div>
      </div>

      <div className={classes.divider} aria-hidden />

      <div className={classes.statsRow} aria-hidden>
        <div>
          <div className={classes.points}>{isBye ? "—" : formatPoints(data.actualPoints)}</div>
          <div className={classes.pointsLabel}>Points</div>
        </div>
        <div className={classes.proj}>
          <div className={[classes.projValue, isLive && classes.projValueLive].filter(Boolean).join(" ")}>
            {isBye ? "—" : formatProj(proj)}
          </div>
          <div className={classes.pointsLabel}>{isLive ? "Live proj" : "Proj"}</div>
        </div>
      </div>
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
  return <span className={classes.slotChip}>{label}</span>;
}
