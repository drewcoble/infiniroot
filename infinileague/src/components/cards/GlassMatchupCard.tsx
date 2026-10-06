import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import { injuryColor } from "@shared/injuryColor";
import { positionColorOrDefault } from "@shared/positionColors";
import {
  formatPoints,
  formatProj,
  gameLine,
  paceVsProjection,
  pillStyle,
  type GlassMatchupCardData,
} from "./cardShared";
import { ExpandedMatchupCard } from "./ExpandedMatchupCard";
import { GameStatusGlyph } from "./GameStatusGlyph";
import { PointsMeter } from "./PointsMeter";
import { useLongPress } from "./useLongPress";
import classes from "./GlassMatchupCard.module.css";

export type { GlassMatchupCardData } from "./cardShared";

// Screen readers get one sentence instead of hopping through every pill
// and number in visual order.
function ariaSummary(data: GlassMatchupCardData): string {
  const parts = [
    data.name,
    `${data.position}${data.positionRank > 0 ? ` ${data.positionRank}` : ""}`,
    `${data.team} ${gameLine(data)}`,
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

// Base (collapsed) Matchup card - name, position, this week's game, and
// the two numbers a matchup is about: actual points large, with projection
// (and live projection mid-game) drawn on a meter under it. A live game
// shows as the card's green tint plus a pulsing dot on the game clock
// (see GameStatusGlyph for the other states' icons).
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
  const isPre = data.gameState === "pre";
  const positionColor = positionColorOrDefault(data.position);

  const cardRef = useRef<HTMLDivElement>(null);
  // The element the detail card anchors to, captured at open time - null
  // while collapsed.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const expanded = anchor !== null;
  const open = useCallback(() => setAnchor(cardRef.current), []);
  const close = useCallback(() => {
    setAnchor(null);
    cardRef.current?.focus();
  }, []);
  const { pressing, handlers } = useLongPress(open);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  };

  return (
    <>
      <div
        ref={cardRef}
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
        tabIndex={0}
        role="button"
        aria-haspopup="dialog"
        aria-expanded={expanded}
        aria-label={ariaSummary(data)}
        aria-description="Press and hold for details"
        onKeyDown={onKeyDown}
        // Screen readers activate with a synthetic click (detail 0) rather
        // than a long press - let that open the details too, while a real
        // tap (detail 1) stays a no-op so scrolling past cards is safe.
        onClick={(event) => {
          if (event.detail === 0) open();
        }}
        {...handlers}
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
            <GameStatusGlyph state={data.gameState} />
            <span className={classes.gameLineText}>{gameLine(data)}</span>
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
