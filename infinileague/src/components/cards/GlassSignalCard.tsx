import { useId } from "react";
import { X } from "lucide-react";
import { injuryColor } from "@shared/injuryColor";
import { positionColorOrDefault, type Position } from "@shared/positionColors";
import { formatTradeValue } from "../../lib/tradeValue";
import { formatProj, pillStyle } from "./cardShared";
import { GlassPopover } from "./GlassPopover";
import { StatGroups } from "./StatGroups";
import { useExpandableCard } from "./useExpandableCard";
import { PlayerHeadshot } from "./PlayerHeadshot";
import classes from "./GlassMatchupCard.module.css";

export interface GlassSignalCardData {
  fpid: number;
  name: string;
  position: Position;
  // ROS position rank (0 = none) and season-to-date position rank.
  positionRank: number;
  // Where the market ranks him at his position - the gap between this and
  // positionRank is what makes him a buy or sell.
  marketPositionRank: number;
  seasonPositionRank: number | undefined;
  team: string | null;
  // Who rosters him - shown on Buys (where he'd come from); null on Sells
  // (he's yours).
  owner: string | null;
  injury?: { status: string; statusShort: string } | undefined;
  signal: "buy" | "sell";
  infinivalue: number;
  marketValue: number;
  avgValue: number;
  seasonPpg: number | undefined;
  rosPpg: number | undefined;
}

const positionLabel = (position: string, rank: number | undefined) =>
  rank ? `${position}${rank}` : "—";

// Slim player card for the Trade tab's Buys / Sells strips - about an
// analyzer card's width. Our position rank badge and the market's rank
// (what makes him a buy or sell) on top, the name, who rosters him (Buys)
// or his NFL team (Sells), then market | infinivalue.
// A tap loads him into the analyzer below; long-press opens his value
// details.
export function GlassSignalCard({
  data,
  displayName = data.name,
  active,
  onTap,
}: {
  data: GlassSignalCardData;
  displayName?: string;
  // He's selected in the analyzer right now.
  active: boolean;
  onTap: () => void;
}) {
  const marketRankLabel = positionLabel(data.position, data.marketPositionRank);
  const label = [
    data.name,
    positionLabel(data.position, data.positionRank),
    `market rank ${marketRankLabel}`,
    data.owner ? `rostered by ${data.owner}` : data.team,
    data.signal === "buy" ? "buy" : "sell",
    `infinivalue ${formatTradeValue(data.infinivalue)}`,
    `market value ${formatTradeValue(data.marketValue)}`,
  ]
    .filter(Boolean)
    .join(", ");
  const { cardProps, anchor, expanded, pressing, close } = useExpandableCard(label, { onTap });
  const titleId = useId();
  const positionColor = positionColorOrDefault(data.position);

  return (
    <>
      <div
        {...cardProps}
        role="button"
        aria-pressed={active}
        className={[
          classes.card,
          classes.pressable,
          classes.signalCard,
          active && classes.tradeSelected,
          pressing && classes.pressing,
          expanded && classes.hidden,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className={classes.topRow} aria-hidden>
          <div className={classes.pills}>
            <span className={classes.pill} style={pillStyle(positionColor)}>
              {positionLabel(data.position, data.positionRank)}
            </span>
            <PlayerHeadshot
              fpid={data.fpid}
              position={data.position}
              team={data.team}
              className={classes.headshotSmall}
            />
          </div>
          <span
            className={`${classes.signalGap} ${
              data.signal === "buy" ? classes.impactUp : classes.impactDown
            }`}
          >
            Mkt {marketRankLabel}
          </span>
        </div>
        <div aria-hidden>
          <div className={classes.nameRow}>
            <span className={classes.name}>{displayName}</span>
            {data.injury && (
              <span
                className={`${classes.pill} ${classes.nameBadge}`}
                style={pillStyle(injuryColor(data.injury.status))}
              >
                {data.injury.statusShort}
              </span>
            )}
          </div>
          <div className={classes.gameLine}>
            <span className={classes.gameLineText}>{data.owner ?? data.team ?? "FA"}</span>
          </div>
        </div>
        <div
          className={`${classes.statsRow} ${classes.statsRowSplit} ${classes.tradeStats}`}
          aria-hidden
        >
          <span className={classes.projSmall}>Mkt {formatTradeValue(data.marketValue)}</span>
          <span className={classes.tradeRos}>
            <span className={classes.tradeRosLabel}>INFINI</span>
            {formatTradeValue(data.infinivalue)}
          </span>
        </div>
      </div>

      {anchor && (
        <GlassPopover anchor={anchor} onClose={close} labelledBy={titleId}>
          <div className={classes.expandedHeader}>
            <PlayerHeadshot fpid={data.fpid} position={data.position} team={data.team} />
            <div style={{ minWidth: 0 }}>
              <div id={titleId} className={classes.expandedName}>
                {data.name}
              </div>
              <div className={classes.gameLine}>
                <span className={classes.gameLineText}>
                  {[data.team, data.owner ?? "Your team"].filter(Boolean).join(" · ")}
                </span>
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
              {positionLabel(data.position, data.positionRank)}
            </span>
            {data.injury && (
              <span className={classes.pill} style={pillStyle(injuryColor(data.injury.status))}>
                {data.injury.status}
              </span>
            )}
            <span
              className={`${classes.pill} ${classes.nameBadge}`}
              style={pillStyle(data.signal === "buy" ? "green" : "red")}
            >
              {data.signal === "buy" ? "BUY" : "SELL"}
            </span>
          </div>

          <StatGroups
            groups={[
              {
                label: "Trade value",
                items: [
                  { label: "Infinivalue", value: formatTradeValue(data.infinivalue) },
                  { label: "Market value", value: formatTradeValue(data.marketValue) },
                  { label: "Avg value", value: formatTradeValue(data.avgValue) },
                  { label: "Mkt rank", value: marketRankLabel },
                ],
              },
              {
                columns: ["Season", "ROS"],
                rows: [
                  { label: "PPG", values: [formatProj(data.seasonPpg), formatProj(data.rosPpg)] },
                  {
                    label: "Pos rank",
                    values: [
                      positionLabel(data.position, data.seasonPositionRank),
                      positionLabel(data.position, data.positionRank),
                    ],
                  },
                ],
              },
            ]}
          />
        </GlassPopover>
      )}
    </>
  );
}

// Loading placeholder in the signal card's shape.
export function GlassSignalSkeleton() {
  return (
    <div className={`${classes.card} ${classes.signalCard}`} aria-hidden>
      <span className={classes.skeletonBar} style={{ width: 38, height: 20 }} />
      <span className={classes.skeletonBar} style={{ width: "75%", height: 14 }} />
      <span className={classes.skeletonBar} style={{ width: "55%", height: 10 }} />
      <span className={classes.skeletonBar} style={{ width: "100%", height: 14 }} />
    </div>
  );
}
