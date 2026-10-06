import { injuryColor } from "@shared/injuryColor";
import { positionColorOrDefault } from "@shared/positionColors";
import { ariaSummary, gameLine, pillStyle, type GlassMatchupCardData } from "./cardShared";
import { ExpandedMatchupCard } from "./ExpandedMatchupCard";
import { GameStatusGlyph } from "./GameStatusGlyph";
import { PointsHeadline, PointsMeter } from "./PointsMeter";
import { useExpandableCard } from "./useExpandableCard";
import classes from "./GlassMatchupCard.module.css";

export type { GlassMatchupCardData } from "./cardShared";

// Base (collapsed) Matchup card - name, position, this week's game, and
// the two numbers a matchup is about: actual points large, with projection
// (and live projection mid-game) drawn on a meter under it. A live game
// shows as the card's green tint plus a pulsing dot in the top-right
// corner (see GameStatusGlyph for the other states' icons).
// Long-press (or Enter/Space when focused) opens ExpandedMatchupCard over
// it; the base card stays in the layout, just hidden, so nothing shifts.
export function GlassMatchupCard({
  data,
  displayName = data.name,
  slot,
  scaleMax,
}: {
  data: GlassMatchupCardData;
  displayName?: string;
  slot: string;
  scaleMax: number;
}) {
  const isLive = data.gameState === "live";
  const isBye = data.gameState === "bye";
  const positionColor = positionColorOrDefault(data.position);

  const { cardProps, anchor, expanded, pressing, close } = useExpandableCard(ariaSummary(data));

  return (
    <>
      <div
        {...cardProps}
        className={[
          classes.card,
          classes.pressable,
          isLive && classes.live,
          isBye && classes.muted,
          pressing && classes.pressing,
          expanded && classes.hidden,
        ]
          .filter(Boolean)
          .join(" ")}
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
          <GameStatusGlyph state={data.gameState} />
        </div>

        <div aria-hidden>
          <div className={classes.name}>{displayName}</div>
          <div className={classes.gameLine}>
            <span className={classes.gameLineText}>{gameLine(data)}</span>
          </div>
        </div>

        <div className={classes.statsRow} aria-hidden>
          <PointsHeadline data={data} />
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
      {anchor && (
        <ExpandedMatchupCard
          data={data}
          slot={slot}
          anchor={anchor}
          scaleMax={scaleMax}
          onClose={close}
        />
      )}
    </>
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
