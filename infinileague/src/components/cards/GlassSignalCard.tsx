import { injuryColor } from "@shared/injuryColor";
import { positionColorOrDefault, type Position } from "@shared/positionColors";
import { formatTradeValue } from "../../lib/tradeValue";
import { pillStyle } from "./cardShared";
import { useExpandableCard } from "./useExpandableCard";
import { PlayerHeadshot } from "./PlayerHeadshot";
import { PlayerPopover } from "../player/PlayerPopover";
import { usePlayerPopoverQueries } from "../player/usePlayerPopoverQueries";
import classes from "./GlassMatchupCard.module.css";

export interface GlassSignalCardData {
  fpid: number;
  name: string;
  position: Position;
  // ROS position rank (0 = none).
  positionRank: number;
  // Where the market ranks him at his position - the gap between this and
  // positionRank is what makes him a buy or sell.
  marketPositionRank: number;
  team: string | null;
  // Who rosters him - shown on Buys (where he'd come from); null on Sells
  // (he's yours).
  owner: string | null;
  injury?: { status: string; statusShort: string } | undefined;
  signal: "buy" | "sell";
  infinivalue: number;
  marketValue: number;
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
  // Start the popover's data loading as soon as a press begins, so it
  // opens fully drawn (see usePlayerPopoverQueries).
  usePlayerPopoverQueries(data.fpid, pressing || expanded);
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
          <span className={classes.pill} style={pillStyle(positionColor)}>
            {positionLabel(data.position, data.positionRank)}
          </span>
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
          {/* Headshot and NFL team, then (Buys) who rosters him - who to
              start the trade with - on a line of its own, since the card's
              too narrow for both on one. */}
          <div className={classes.gameLine}>
            <PlayerHeadshot
              fpid={data.fpid}
              position={data.position}
              team={data.team}
              className={classes.headshotInline}
            />
            <span className={classes.gameLineText}>{data.team ?? "FA"}</span>
          </div>
          {data.owner && (
            <div className={`${classes.gameLine} ${classes.signalOwner}`}>
              <span className={classes.gameLineText}>{data.owner}</span>
            </div>
          )}
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
        <PlayerPopover
          fpid={data.fpid}
          anchor={anchor}
          onClose={close}
          context={{}}
        />
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
