import { injuryColor } from "@shared/injuryColor";
import { positionColorOrDefault } from "@shared/positionColors";
import {
  ariaSummary,
  formatPoints,
  formatProj,
  pillStyle,
  positionBadge,
  type GlassMatchupCardData,
} from "./cardShared";
import { ExpandedMatchupCard } from "./ExpandedMatchupCard";
import { GameLineText } from "./GameLineText";
import { GameStatusGlyph } from "./GameStatusGlyph";
import { GlassSlotChip } from "./GlassMatchupCard";
import { PointsMeter } from "./PointsMeter";
import { useExpandableCard } from "./useExpandableCard";
import classes from "./GlassMatchupCard.module.css";

// Full-width (My Team) version of the glass player card - same pieces as
// GlassMatchupCard, laid out for a full row on mobile: the roster slot chip
// sits outside the card on the left (like the Matchup tab's slot chips
// between columns), and inside it the full name with position/injury/game
// beneath, status (live clock / icon) on the name's row with the projection
// and actual score on the game line's row, and the meter running the width
// underneath. Full names fit here, so no shortening.
export function GlassRosterCard({
  data,
  slot,
  scaleMax,
}: {
  data: GlassMatchupCardData;
  slot: string;
  scaleMax: number;
}) {
  const isLive = data.gameState === "live";
  const isBye = data.gameState === "bye";
  const { cardProps, anchor, expanded, pressing, close } = useExpandableCard(
    `${slot}, ${ariaSummary(data)}`,
  );

  return (
    <div className={classes.rosterRow}>
      <GlassSlotChip label={slot} />
      <div
        {...cardProps}
        className={[
          classes.card,
          classes.wide,
          classes.pressable,
          isLive && classes.live,
          isBye && classes.muted,
          pressing && classes.pressing,
          expanded && classes.hidden,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {/* Two shared rows so each side lines up with the other: name |
            status icon + points, then position/injury/game | projection. */}
        <div className={`${classes.name} ${classes.wideName}`} aria-hidden>
          {data.name}
        </div>
        <div className={classes.widePoints} aria-hidden>
          {/* While live, the clock sits left of the status dot (the game
              line below then shows just the opponent) - same as the
              Matchup cards' top row. */}
          {isLive && data.status && <span className={classes.topClock}>{data.status}</span>}
          <GameStatusGlyph state={data.gameState} />
        </div>

        <div className={classes.wideDetail} aria-hidden>
          <span className={classes.pill} style={pillStyle(positionColorOrDefault(data.position))}>
            {positionBadge(data)}
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
          <span
            className={`${classes.gameLine} ${classes.wideGameLine} ${classes.wideGameLineFill}`}
          >
            <GameLineText data={data} hideLiveClock />
          </span>
        </div>
        {/* The numbers share the second row: the projection spelled out
            small (start/sit is what this screen is for, so not just the
            meter's tick), then the actual score once the game has started.
            Status (clock / dot) stays on the row above. */}
        {data.gameState !== "bye" && (
          <div className={`${classes.wideProj} ${classes.wideNumbers}`} aria-hidden>
            <span>Proj {formatProj(data.projectedPoints)}</span>
            {data.gameState !== "pre" && (
              <span className={`${classes.points} ${classes.playerPoints}`}>
                {formatPoints(data.actualPoints)}
              </span>
            )}
          </div>
        )}

        {!isBye && (
          <div className={classes.wideMeter}>
            <PointsMeter
              actual={data.actualPoints ?? 0}
              projected={data.projectedPoints}
              liveProjected={isLive ? data.liveProjectedPoints : undefined}
              isFinal={data.gameState === "final"}
              scaleMax={scaleMax}
            />
          </div>
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
    </div>
  );
}

export function EmptyGlassRosterCard({ slot }: { slot: string }) {
  return (
    <div className={classes.rosterRow} role="group" aria-label={`${slot}, empty slot`}>
      <GlassSlotChip label={slot} />
      <div className={`${classes.card} ${classes.wide} ${classes.wideEmpty}`} aria-hidden>
        <div className={classes.wideInfo}>
          <span className={classes.wideEmptyText}>Empty</span>
        </div>
      </div>
    </div>
  );
}

// Loading placeholder in the full-width card's shape (slot chip outside,
// name/detail bars and a meter bar inside) - see GlassSkeletonCard.
export function GlassRosterSkeletonCard() {
  return (
    <div className={classes.rosterRow} aria-hidden>
      <GlassSlotChip label="" />
      <div className={`${classes.card} ${classes.wide} ${classes.wideSkeleton}`}>
        <span
          className={`${classes.skeletonBar} ${classes.wideName}`}
          style={{ width: "55%", height: 14 }}
        />
        <span
          className={`${classes.skeletonBar} ${classes.widePoints}`}
          style={{ width: 44, height: 15 }}
        />
        <span
          className={`${classes.skeletonBar} ${classes.wideDetail}`}
          style={{ width: "70%", height: 12 }}
        />
        <span
          className={`${classes.skeletonBar} ${classes.wideMeter}`}
          style={{ height: 5, marginTop: 6 }}
        />
      </div>
    </div>
  );
}
