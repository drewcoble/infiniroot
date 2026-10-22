import { Check } from "lucide-react";
import { injuryColor } from "@shared/injuryColor";
import { positionColorOrDefault, type Position } from "@shared/positionColors";
import { formatTradeValue } from "../../lib/tradeValue";
import { formatProj, pillStyle } from "./cardShared";
import { useExpandableCard } from "./useExpandableCard";
import { PlayerHeadshot } from "./PlayerHeadshot";
import { PlayerPopover } from "../player/PlayerPopover";
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
  // The rosVOR board's per-game rates - undefined when the player isn't on
  // it (shown as a dash rather than a made-up 0.0).
  seasonPpg: number | undefined;
  rosPpg: number | undefined;
  // Season-to-date position rank (lib/seasonPositionRanks.ts) - the
  // detail table's Season counterpart of positionRank.
  seasonPositionRank: number | undefined;
  // Trade value (convex/infinileague/season/tradeValues.ts): the average
  // ("avg value"), FantasyCalc's market value (null = not priced there -
  // K/DST), and our infinivalue. undefined while the values load.
  tradeValue: number | undefined;
  marketValue: number | null | undefined;
  projectionValue: number | undefined;
  // Rank at his position by market value (null = not priced there,
  // undefined while the values load) - what the buy / sell call compares
  // positionRank against.
  marketPositionRank: number | null | undefined;
  // Ranked well above / below the market at his position - see
  // tradeValues.ts.
  signal: "buy" | "sell" | null | undefined;
}

// Which numbers the cards show - the Trade tab's top switch. Value shows
// the market (FantasyCalc) value small on the left and the avg value
// that gets added up on the right; the rest show season to date on the
// left and rest of season on the right.
export type TradeMetric = "value" | "ppg" | "rank";

const formatPositionRank = (position: string, rank: number | undefined) =>
  rank ? `${position}${rank}` : "—";
const formatValue = (value: number | null | undefined) =>
  value === undefined || value === null ? "—" : formatTradeValue(value);

// Buy / sell call (our position rank vs. the market's) as a glass badge -
// green buy, red sell.
function SignalBadge({ signal }: { signal: "buy" | "sell" }) {
  return (
    <span
      className={`${classes.pill} ${classes.nameBadge}`}
      style={pillStyle(signal === "buy" ? "green" : "red")}
      title={
        signal === "buy"
          ? "Ranked well above the market at his position"
          : "Ranked well below the market at his position"
      }
    >
      {signal === "buy" ? "BUY" : "SELL"}
    </span>
  );
}

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
    // K/DST have no market value - show the infinivalue on the left
    // instead, which is all their avg value is.
    const market = data.marketValue !== null;
    const left = market ? formatValue(data.marketValue) : formatValue(data.projectionValue);
    const right = formatValue(data.tradeValue);
    return {
      leftLabel: market ? "Mkt" : "Infini",
      left,
      rightLabel: "AVG",
      right,
      leftSpoken: `${market ? "market value" : "infinivalue"} ${left}`,
      rightSpoken: `avg value ${right}`,
    };
  }
  const [season, ros, spoken] =
    metric === "rank"
      ? [
          formatPositionRank(data.position, data.seasonPositionRank),
          formatPositionRank(data.position, data.positionRank),
          "position rank",
        ]
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
  metric,
  selected,
  onToggle,
}: {
  data: GlassTradeCardData;
  displayName?: string;
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
    data.signal === "buy" ? "buy: ranked well above market" : null,
    data.signal === "sell" ? "sell: ranked well below market" : null,
  ]
    .filter(Boolean)
    .join(", ");
  const { cardProps, anchor, expanded, pressing, close } = useExpandableCard(label, {
    onTap: onToggle,
  });

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
            {data.signal && <SignalBadge signal={data.signal} />}
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
          {/* Headshot, then the NFL team. */}
          <div className={classes.gameLine}>
            <PlayerHeadshot
              fpid={data.fpid}
              position={data.position}
              team={data.team}
              className={classes.headshotInline}
            />
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
        <PlayerPopover
          fpid={data.fpid}
          anchor={anchor}
          onClose={close}
          context={{ inTrade: selected }}
        />
      )}
    </>
  );
}
