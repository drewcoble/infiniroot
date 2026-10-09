import { useId } from "react";
import { Check, X } from "lucide-react";
import { injuryColor } from "@shared/injuryColor";
import { positionColorOrDefault, type Position } from "@shared/positionColors";
import { formatProj, pillStyle } from "./cardShared";
import { GlassPopover } from "./GlassPopover";
import { useExpandableCard } from "./useExpandableCard";
import classes from "./GlassMatchupCard.module.css";

export interface GlassTradeCardData {
  name: string;
  position: Position;
  // Rest-of-season position rank (the rosVOR board's positionRank) - 0 =
  // not on the board.
  positionRank: number;
  team: string;
  injury?: { status: string; statusShort: string } | undefined;
  isRookie: boolean;
  byeWeek?: number | undefined;
  // The rosVOR board's per-game rates - undefined when the player isn't on
  // it (shown as a dash rather than a made-up 0.0).
  seasonPpg: number | undefined;
  rosPpg: number | undefined;
  // Value over replacement, season to date and rest of season.
  seasonVor: number | undefined;
  rosVor: number | undefined;
  // Overall (all-position) VOR ranks, season to date and rest of season.
  seasonRank: number | undefined;
  rosRank: number | undefined;
}

// Which numbers the cards show - the Trade tab's top switch. Each shows
// season to date on the left and rest of season on the right.
export type TradeMetric = "vor" | "ppg" | "rank";

const formatRank = (rank: number | undefined) => (rank ? `#${rank}` : "—");

function metricValues(
  data: GlassTradeCardData,
  metric: TradeMetric,
): { season: string; ros: string } {
  if (metric === "vor") return { season: formatProj(data.seasonVor), ros: formatProj(data.rosVor) };
  if (metric === "rank") {
    return { season: formatRank(data.seasonRank), ros: formatRank(data.rosRank) };
  }
  return { season: formatProj(data.seasonPpg), ros: formatProj(data.rosPpg) };
}

const METRIC_SPOKEN: Record<TradeMetric, string> = {
  vor: "VOR",
  ppg: "PPG",
  rank: "overall rank",
};

// Half-width Trade card - the Matchup card's shape (position badge top-left,
// name, NFL team, numbers along the bottom), but trade-relevant numbers:
// season and rest-of-season points per game instead of this week's score.
// A tap selects the player into the trade (the card turns blue-tinted glass
// and its corner circle fills with a check); long-press opens the detail
// popover.
export function GlassTradeCard({
  data,
  displayName = data.name,
  slot,
  metric,
  selected,
  onToggle,
}: {
  data: GlassTradeCardData;
  displayName?: string;
  slot: string;
  metric: TradeMetric;
  selected: boolean;
  onToggle: () => void;
}) {
  const positionColor = positionColorOrDefault(data.position);
  const positionLabel = `${data.position}${data.positionRank > 0 ? data.positionRank : ""}`;
  const values = metricValues(data, metric);
  const label = [
    data.name,
    positionLabel,
    data.team,
    data.injury?.status,
    `actual ${METRIC_SPOKEN[metric]} ${values.season}`,
    `rest-of-season ${METRIC_SPOKEN[metric]} ${values.ros}`,
  ]
    .filter(Boolean)
    .join(", ");
  const { cardProps, anchor, expanded, pressing, close } = useExpandableCard(label, {
    onTap: onToggle,
  });
  const titleId = useId();

  return (
    <>
      <div
        {...cardProps}
        role="checkbox"
        aria-checked={selected}
        className={[
          classes.card,
          classes.pressable,
          classes.tradeCard,
          selected && classes.tradeSelected,
          pressing && classes.pressing,
          expanded && classes.hidden,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className={classes.topRow} aria-hidden>
          <div className={classes.pills}>
            <span className={classes.pill} style={pillStyle(positionColor)}>
              {positionLabel}
            </span>
          </div>
          <span className={classes.tradeCheck}>
            {selected && <Check size={12} strokeWidth={3.5} />}
          </span>
        </div>

        <div aria-hidden>
          <div className={classes.nameRow}>
            <span className={classes.name}>{displayName}</span>
            {data.injury && (
              <span
                className={`${classes.pill} ${classes.nameBadge}`}
                style={pillStyle(injuryColor(data.injury.status))}
                title={data.injury.status}
              >
                {data.injury.statusShort}
              </span>
            )}
          </div>
          <div className={classes.gameLine}>
            <span className={classes.gameLineText}>{data.team || "FA"}</span>
          </div>
        </div>

        {/* The switch's metric: season to date small on the left, rest of
            season - the number a trade is really about - on the right. */}
        <div
          className={`${classes.statsRow} ${classes.statsRowSplit} ${classes.tradeStats}`}
          aria-hidden
        >
          <span className={classes.projSmall}>Actual {values.season}</span>
          <span className={classes.tradeRos}>
            <span className={classes.tradeRosLabel}>ROS</span>
            {values.ros}
          </span>
        </div>
      </div>

      {anchor && (
        <GlassPopover anchor={anchor} onClose={close} labelledBy={titleId}>
          <div className={classes.expandedHeader}>
            <div style={{ minWidth: 0 }}>
              <div id={titleId} className={classes.expandedName}>
                {data.name}
              </div>
              <div className={classes.gameLine}>
                <span className={classes.gameLineText}>{data.team || "Free agent"}</span>
              </div>
            </div>
            <button
              type="button"
              className={classes.closeButton}
              onClick={close}
              aria-label="Close"
            >
              <X size={16} strokeWidth={2.5} />
            </button>
          </div>

          <div className={classes.pills}>
            <span className={classes.pill} style={pillStyle(positionColor)}>
              {positionLabel}
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
            {selected && <span className={classes.statusLabel}>In trade</span>}
          </div>

          <div className={classes.statGrid}>
            {[
              { label: "Season VOR", value: formatProj(data.seasonVor) },
              { label: "Season PPG", value: formatProj(data.seasonPpg) },
              { label: "Season rank", value: formatRank(data.seasonRank) },
              { label: "ROS VOR", value: formatProj(data.rosVor) },
              { label: "ROS PPG", value: formatProj(data.rosPpg) },
              { label: "ROS rank", value: formatRank(data.rosRank) },
              {
                label: "ROS pos rank",
                value: data.positionRank > 0 ? `${data.position}${data.positionRank}` : "—",
              },
              { label: "Slot", value: slot || "—" },
              { label: "Bye", value: data.byeWeek ? `Wk ${data.byeWeek}` : "—" },
            ].map((stat) => (
              <div key={stat.label} className={classes.stat}>
                <div className={classes.statValue}>{stat.value}</div>
                <div className={classes.statLabel}>{stat.label}</div>
              </div>
            ))}
          </div>
        </GlassPopover>
      )}
    </>
  );
}
