import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Minus, TrendingDown, TrendingUp, X } from "lucide-react";
import { BOTTOM_NAV_BOTTOM_OFFSET, BOTTOM_NAV_HEIGHT } from "@shared/constants";
import { injuryColor } from "@shared/injuryColor";
import { positionColorOrDefault } from "@shared/positionColors";
import {
  formatPoints,
  formatProj,
  gameLine,
  paceFor,
  pillStyle,
  type GlassMatchupCardData,
  type Pace,
} from "./cardShared";
import { GameStatusGlyph } from "./GameStatusGlyph";
import { PointsMeter } from "./PointsMeter";
import classes from "./GlassMatchupCard.module.css";

const MAX_WIDTH = 380;
// Breathing room from the viewport edges, and what's kept clear at the
// bottom for the mobile BottomNav's floating pill.
const EDGE_MARGIN = 12;
const BOTTOM_RESERVE = BOTTOM_NAV_HEIGHT + BOTTOM_NAV_BOTTOM_OFFSET + EDGE_MARGIN;

// The detail card has room to name the state its corner icon stands for.
const STATUS_LABEL = { live: "Live", final: "Final", pre: "Upcoming", bye: "Bye" } as const;

const PACE_ICON = { ahead: TrendingUp, behind: TrendingDown, even: Minus } as const;

function paceSentence(data: GlassMatchupCardData, pace: Pace): string {
  const target = data.gameState === "live" ? data.liveProjectedPoints : data.actualPoints;
  const delta = (target ?? 0) - (data.projectedPoints ?? 0);
  const signed = `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}`;
  if (data.gameState === "live") {
    if (pace === "even") return `On pace to match projection (${signed})`;
    return `On pace ${signed} ${pace === "ahead" ? "over" : "under"} projection`;
  }
  if (pace === "even") return `Finished near projection (${signed})`;
  return `Finished ${signed} ${pace === "ahead" ? "over" : "under"} projection`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={classes.stat}>
      <div className={classes.statValue}>{value}</div>
      <div className={classes.statLabel}>{label}</div>
    </div>
  );
}

// Long-press detail card for one Matchup player. Floats over the page
// (portaled to body, absolutely positioned in document coordinates so it
// scrolls with the content) starting at the base card's own top corner -
// the base card hides underneath while this is open, so it reads as the
// card growing in place without pushing anything else around. Grows toward
// the middle of the screen: left-column cards anchor their left edge,
// right-column cards their right edge.
export function ExpandedMatchupCard({
  data,
  slot,
  anchor,
  scaleMax,
  onClose,
}: {
  data: GlassMatchupCardData;
  slot: string;
  anchor: HTMLElement;
  scaleMax: number;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Positioned directly on the DOM node (not via state) since it depends
  // on the card's own rendered height - one measure-then-place pass before
  // paint, no visible jump.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const rect = anchor.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const width = Math.min(viewportWidth - EDGE_MARGIN * 2, MAX_WIDTH);
    const alignRight = rect.left + rect.width / 2 > viewportWidth / 2;
    const left = Math.min(
      Math.max(alignRight ? rect.right - width : rect.left, EDGE_MARGIN),
      viewportWidth - EDGE_MARGIN - width,
    );
    card.style.width = `${width}px`;
    const bottomLimit = window.innerHeight - BOTTOM_RESERVE;
    const top = Math.max(
      EDGE_MARGIN,
      rect.top + card.offsetHeight > bottomLimit ? bottomLimit - card.offsetHeight : rect.top,
    );
    card.style.left = `${left + window.scrollX}px`;
    card.style.top = `${top + window.scrollY}px`;
    card.style.transformOrigin = `${rect.left + (alignRight ? rect.width : 0) - left}px ${rect.top - top}px`;
    card.dataset.placed = "true";
    card.focus();
  }, [anchor]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // Its position was computed for the old viewport - closing is simpler
    // and less surprising than re-anchoring mid-rotation.
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const isLive = data.gameState === "live";
  const isPre = data.gameState === "pre";
  const isBye = data.gameState === "bye";
  const pace = paceFor(data);
  const PaceIcon = pace ? PACE_ICON[pace] : null;

  return createPortal(
    <>
      {/* onClick rather than onPointerDown: a pointerdown close would let
          the rest of that tap land on whatever's underneath (a tab link,
          say). The release of the long-press that opened this doesn't
          click here either - its pointerdown was on the base card. */}
      <div className={classes.scrim} onClick={onClose} aria-hidden />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={[classes.card, classes.expanded, isLive && classes.live]
          .filter(Boolean)
          .join(" ")}
      >
        <div className={classes.expandedHeader}>
          <div style={{ minWidth: 0 }}>
            <div id={titleId} className={classes.expandedName}>
              {data.name}
            </div>
            <div className={classes.gameLine}>
              <span className={classes.gameLineText}>
                {data.team} {gameLine(data)}
              </span>
            </div>
          </div>
          <button
            type="button"
            className={classes.closeButton}
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} strokeWidth={2.5} />
          </button>
        </div>

        <div className={classes.pills}>
          <span className={classes.pill} style={pillStyle(positionColorOrDefault(data.position))}>
            {data.position}
            {data.positionRank > 0 ? data.positionRank : ""}
          </span>
          {data.injury && (
            <span className={classes.pill} style={pillStyle(injuryColor(data.injury.status))}>
              {data.injury.status}
            </span>
          )}
          {data.isRookie && (
            <span className={classes.pill} style={pillStyle("grape")}>
              Rookie
            </span>
          )}
          {!isBye && (
            <span className={classes.statusLabel}>
              <GameStatusGlyph state={data.gameState} />
              {STATUS_LABEL[data.gameState]}
            </span>
          )}
        </div>

        {!isBye && (
          <div>
            <div className={classes.statsRow}>
              {isPre ? (
                <>
                  <span className={`${classes.expandedPoints} ${classes.pointsPending}`}>
                    {formatProj(data.projectedPoints)}
                  </span>
                  <span className={classes.pointsUnit}>projected</span>
                </>
              ) : (
                <>
                  <span className={classes.expandedPoints}>{formatPoints(data.actualPoints)}</span>
                  <span className={classes.pointsUnit}>points</span>
                </>
              )}
            </div>
            <PointsMeter
              actual={data.actualPoints ?? 0}
              projected={data.projectedPoints}
              liveProjected={isLive ? data.liveProjectedPoints : undefined}
              isFinal={data.gameState === "final"}
              scaleMax={scaleMax}
              large
            />
            {/* The meter's legend - each swatch is the same mark it names,
                so the bar reads without color alone. */}
            <div className={classes.legend}>
              {!isPre && (
                <span className={classes.legendItem}>
                  <span
                    className={[
                      classes.swatchFill,
                      data.gameState === "final" && pace && classes[`final_${pace}`],
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  />
                  Actual {formatPoints(data.actualPoints)}
                </span>
              )}
              <span className={classes.legendItem}>
                <span className={classes.swatchTick} />
                Proj {formatProj(data.projectedPoints)}
              </span>
              {isLive && (
                <span className={classes.legendItem}>
                  <span
                    className={[classes.swatchGhost, pace && classes[`pace_${pace}`]]
                      .filter(Boolean)
                      .join(" ")}
                  />
                  Pace {formatProj(data.liveProjectedPoints)}
                </span>
              )}
            </div>
            {pace && PaceIcon && (
              <div className={classes.paceLine}>
                <PaceIcon size={15} strokeWidth={2.5} className={classes[`paceIcon_${pace}`]} />
                {paceSentence(data, pace)}
              </div>
            )}
          </div>
        )}

        <div className={classes.statGrid}>
          <Stat label="Season PPG" value={formatProj(data.seasonPpg)} />
          <Stat label="ROS PPG" value={formatProj(data.rosPpg)} />
          <Stat
            label="Week rank"
            value={data.weekPositionRank ? `${data.position}${data.weekPositionRank}` : "—"}
          />
          <Stat label="Slot" value={slot} />
          <Stat label="Bye" value={data.byeWeek ? `Wk ${data.byeWeek}` : "—"} />
        </div>
      </div>
    </>,
    document.body,
  );
}
