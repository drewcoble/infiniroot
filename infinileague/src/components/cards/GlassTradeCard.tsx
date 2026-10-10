import { useId } from "react";
import { Check, X } from "lucide-react";
import { injuryColor } from "@shared/injuryColor";
import { positionColorOrDefault, type Position } from "@shared/positionColors";
import { formatTradeValue } from "../../lib/tradeValue";
import { formatProj, pillStyle } from "./cardShared";
import { GlassPopover } from "./GlassPopover";
import { PlayerGameLog } from "./PlayerGameLog";
import { useExpandableCard } from "./useExpandableCard";
import classes from "./GlassMatchupCard.module.css";

export interface GlassTradeCardData {
  // Absent for an empty roster slot - no game log then.
  fpid?: number | undefined;
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
  // Trade value (convex/infinileague/season/tradeValues.ts): the blend,
  // FantasyCalc's market value (null = not priced there - K/DST), and our
  // projection value. undefined while the values load.
  tradeValue: number | undefined;
  marketValue: number | null | undefined;
  projectionValue: number | undefined;
}

// Which numbers the cards show - the Trade tab's top switch. Value shows
// the market (FantasyCalc) value small on the left and the trade value
// that gets added up on the right; the rest show season to date on the
// left and rest of season on the right.
export type TradeMetric = "value" | "vor" | "ppg" | "rank";

const formatRank = (rank: number | undefined) => (rank ? `#${rank}` : "—");
const formatValue = (value: number | null | undefined) =>
  value === undefined || value === null ? "—" : formatTradeValue(value);

interface MetricValues {
  leftLabel: string;
  left: string;
  rightLabel: string;
  right: string;
  // Screen-reader wording for each side.
  leftSpoken: string;
  rightSpoken: string;
}

function metricValues(data: GlassTradeCardData, metric: TradeMetric): MetricValues {
  if (metric === "value") {
    // K/DST have no market value - show the projection value on the left
    // instead, which is all their trade value is.
    const market = data.marketValue !== null;
    const left = market ? formatValue(data.marketValue) : formatValue(data.projectionValue);
    const right = formatValue(data.tradeValue);
    return {
      leftLabel: market ? "Mkt" : "Proj",
      left,
      rightLabel: "VAL",
      right,
      leftSpoken: `${market ? "market value" : "projection value"} ${left}`,
      rightSpoken: `trade value ${right}`,
    };
  }
  const [season, ros, spoken] =
    metric === "vor"
      ? [formatProj(data.seasonVor), formatProj(data.rosVor), "VOR"]
      : metric === "rank"
        ? [formatRank(data.seasonRank), formatRank(data.rosRank), "overall rank"]
        : [formatProj(data.seasonPpg), formatProj(data.rosPpg), "PPG"];
  return {
    leftLabel: "Actual",
    left: season,
    rightLabel: "ROS",
    right: ros,
    leftSpoken: `actual ${spoken} ${season}`,
    rightSpoken: `rest-of-season ${spoken} ${ros}`,
  };
}

// Half-width Trade card - the Matchup card's shape (position badge top-left,
// name, NFL team, numbers along the bottom), but trade-relevant numbers:
// trade value and season / rest-of-season stats instead of this week's score.
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
    values.leftSpoken,
    values.rightSpoken,
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
          <span className={classes.projSmall}>
            {values.leftLabel} {values.left}
          </span>
          <span className={classes.tradeRos}>
            <span className={classes.tradeRosLabel}>{values.rightLabel}</span>
            {values.right}
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
              { label: "Trade value", value: formatValue(data.tradeValue) },
              {
                label: "Market",
                value: data.marketValue === null ? "n/a" : formatValue(data.marketValue),
              },
              { label: "Proj value", value: formatValue(data.projectionValue) },
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

          {data.fpid !== undefined && <PlayerGameLog fpid={data.fpid} position={data.position} />}
        </GlassPopover>
      )}
    </>
  );
}
