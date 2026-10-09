import { useId } from "react";
import { Minus, TrendingDown, TrendingUp, X } from "lucide-react";
import { injuryColor } from "@shared/injuryColor";
import { positionColorOrDefault } from "@shared/positionColors";
import {
  formatPoints,
  formatProj,
  paceFor,
  pillStyle,
  positionBadge,
  type GlassMatchupCardData,
  type Pace,
} from "./cardShared";
import { GameLineText } from "./GameLineText";
import { GameStatusGlyph } from "./GameStatusGlyph";
import { GlassPopover } from "./GlassPopover";
import { PointsMeter } from "./PointsMeter";
import classes from "./GlassMatchupCard.module.css";

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

// This week's rank, named for which one it is: actual so far while live,
// actual once final, the projection before kickoff.
function weekRankStat(data: GlassMatchupCardData): { label: string; value: string } {
  const format = (rank: number | undefined) => (rank ? `${data.position}${rank}` : "—");
  if (data.gameState === "live")
    return { label: "Live rank", value: format(data.weekActualPositionRank) };
  if (data.gameState === "pre") return { label: "Proj rank", value: format(data.weekPositionRank) };
  return { label: "Week rank", value: format(data.weekActualPositionRank) };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={classes.stat}>
      <div className={classes.statValue}>{value}</div>
      <div className={classes.statLabel}>{label}</div>
    </div>
  );
}

// Long-press detail card for one player (Matchup and My Team cards) - the
// popover shell, placement, and dismissal are GlassPopover's.
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
  const titleId = useId();

  const isLive = data.gameState === "live";
  const isPre = data.gameState === "pre";
  const isBye = data.gameState === "bye";
  const pace = paceFor(data);
  const PaceIcon = pace ? PACE_ICON[pace] : null;

  return (
    <GlassPopover
      anchor={anchor}
      onClose={onClose}
      labelledBy={titleId}
      className={isLive && classes.live}
    >
      <div className={classes.expandedHeader}>
        <div style={{ minWidth: 0 }}>
          <div id={titleId} className={classes.expandedName}>
            {data.name}
          </div>
          <div className={classes.gameLine}>
            <GameLineText data={data} prefix={data.team} />
          </div>
        </div>
        <button type="button" className={classes.closeButton} onClick={onClose} aria-label="Close">
          <X size={16} strokeWidth={2.5} />
        </button>
      </div>

      <div className={classes.pills}>
        <span className={classes.pill} style={pillStyle(positionColorOrDefault(data.position))}>
          {positionBadge(data)}
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
                <span className={`${classes.expandedPoints} ${classes.playerPoints}`}>
                  {formatPoints(data.actualPoints)}
                </span>
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
        <Stat {...weekRankStat(data)} />
        <Stat
          label="ROS rank"
          value={data.positionRank > 0 ? `${data.position}${data.positionRank}` : "—"}
        />
        <Stat label="Slot" value={slot} />
        <Stat label="Bye" value={data.byeWeek ? `Wk ${data.byeWeek}` : "—"} />
      </div>
    </GlassPopover>
  );
}
