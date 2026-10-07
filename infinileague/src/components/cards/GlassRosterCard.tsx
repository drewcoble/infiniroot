import { injuryColor } from "@shared/injuryColor";
import { positionColorOrDefault } from "@shared/positionColors";
import {
  ariaSummary,
  formatProj,
  gameLine,
  pillStyle,
  positionBadge,
  type GlassMatchupCardData,
} from "./cardShared";
import { ExpandedMatchupCard } from "./ExpandedMatchupCard";
import { GameStatusGlyph } from "./GameStatusGlyph";
import { GlassSlotChip } from "./GlassMatchupCard";
import { PointsHeadline, PointsMeter } from "./PointsMeter";
import { useExpandableCard } from "./useExpandableCard";
import classes from "./GlassMatchupCard.module.css";

// Full-width (My Team) version of the glass player card - same pieces as
// GlassMatchupCard, laid out for a full row on mobile: the roster slot chip
// sits outside the card on the left (like the Matchup tab's slot chips
// between columns), and inside it the full name with position/injury/game
// beneath, the status icon and headline points on the name's row with the
// projection on the game line's row, and the meter running the width
// underneath. Full names fit here, so no
// shortening.
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
          <GameStatusGlyph state={data.gameState} />
          {/* Nothing scored yet before kickoff - the number slot stays
              empty and the projection sits on the row below as usual. */}
          {data.gameState !== "pre" && (
            <div className={classes.statsRow}>
              <PointsHeadline data={data} />
            </div>
          )}
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
          <span className={`${classes.gameLine} ${classes.wideGameLine}`}>
            <span className={classes.gameLineText}>{gameLine(data)}</span>
          </span>
        </div>
        {/* Start/sit is what this screen is for, so the projection is
            spelled out as a number here, not just the meter's tick - always
            small and on this row, upcoming games included. */}
        {data.gameState !== "bye" && (
          <div className={classes.wideProj} aria-hidden>
            Proj {formatProj(data.projectedPoints)}
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
