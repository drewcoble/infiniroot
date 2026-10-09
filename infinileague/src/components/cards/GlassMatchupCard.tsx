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
          data.gameState === "final" && classes.finalCard,
          pressing && classes.pressing,
          expanded && classes.hidden,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className={classes.topRow} aria-hidden>
          <div className={classes.pills}>
            <span className={classes.pill} style={pillStyle(positionColor)}>
              {positionBadge(data)}
            </span>
          </div>
          {/* Status in the top row: the clock beside the live dot, "FINAL"
              once it's over, the clock icon before kickoff (the game line
              below then shows just the opponent when live or final). */}
          <div className={classes.topRowStatus}>
            {isLive && data.status && <span className={classes.topClock}>{data.status}</span>}
            {data.gameState === "final" && <span className={classes.topClock}>FINAL</span>}
            <GameStatusGlyph state={data.gameState} />
          </div>
        </div>

        <div aria-hidden>
          {/* Injury badge rides after the name rather than in the top row,
              which only has room for position, live clock, and status dot
              on a half-width card. */}
          <div className={classes.nameRow}>
            <span className={classes.name}>{displayName}</span>
            {data.injury && (
              <span
                className={`${classes.pill} ${classes.injuryPill}`}
                style={pillStyle(injuryColor(data.injury.status))}
                title={data.injury.status}
              >
                {data.injury.statusShort}
              </span>
            )}
          </div>
          <div className={classes.gameLine}>
            <GameLineText data={data} statusInTopRow />
          </div>
        </div>

        {/* Projection small on the left, always labeled "Proj" - the live
            projection (points so far + the unplayed share of the pregame
            projection) while the game is on, the pregame number otherwise -
            and the actual score on the right once the game has started. */}
        {isBye ? (
          <div className={classes.statsRow} aria-hidden>
            <PointsHeadline data={data} />
          </div>
        ) : (
          <div className={`${classes.statsRow} ${classes.statsRowSplit}`} aria-hidden>
            <span className={classes.projSmall}>
              Proj {formatProj(isLive ? data.liveProjectedPoints : data.projectedPoints)}
            </span>
            {data.gameState !== "pre" && (
              <span className={`${classes.points} ${classes.playerPoints}`}>
                {formatPoints(data.actualPoints)}
              </span>
            )}
          </div>
        )}
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

// A recessed well where a card would go. `label` is "Empty" for a real
// unfilled roster slot; pass "" for an alignment filler (the other team has
// more rows in that section) or a roster that's still loading.
export function EmptyGlassCard({ label = "Empty" }: { label?: string }) {
  return (
    <div
      className={`${classes.card} ${classes.empty}`}
      role="group"
      aria-label={label ? "Empty slot" : undefined}
      aria-hidden={label ? undefined : true}
    >
      {label && <span style={{ fontSize: 12 }}>{label}</span>}
    </div>
  );
}

// Loading placeholder in the base card's shape - shimmering bars where the
// position pill, name, game line, points, and meter will land, so the page
// keeps its layout while rosters load instead of showing blank wells.
export function GlassSkeletonCard() {
  return (
    <div className={`${classes.card} ${classes.skeletonCard}`} aria-hidden>
      <span className={classes.skeletonBar} style={{ width: 38, height: 20 }} />
      <div>
        <span className={classes.skeletonBar} style={{ width: "72%", height: 14 }} />
        <span className={classes.skeletonBar} style={{ width: "52%", height: 10, marginTop: 6 }} />
      </div>
      <span className={classes.skeletonBar} style={{ width: "44%", height: 15 }} />
      <span className={classes.skeletonBar} style={{ width: "100%", height: 5 }} />
    </div>
  );
}

// Labeled break between roster sections (Bench / IR / Taxi) - a hairline
// either side of a small caps label, with extra space above so starters
// and reserves read as separate groups.
export function GlassSectionDivider({ label }: { label: string }) {
  return (
    <div className={classes.sectionDivider} role="separator" aria-label={label}>
      <span className={classes.sectionLine} />
      <span className={classes.sectionLabel}>{label}</span>
      <span className={classes.sectionLine} />
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
