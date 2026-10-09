import { useId } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { positionColorOrDefault, type Position } from "@shared/positionColors";
import { pillStyle } from "./cardShared";
import { GlassPopover } from "./GlassPopover";
import { useExpandableCard } from "./useExpandableCard";
import classes from "./GlassMatchupCard.module.css";

export interface TradeSuggestionPlayer {
  fpid: number;
  name: string;
  position: Position;
  team: string | null;
}

// Mirrors convex/infinileague/season/tradeSuggestions.ts's TradeSuggestion.
export interface TradeSuggestion {
  partnerTeamId: string;
  partnerName: string;
  send: TradeSuggestionPlayer[];
  receive: TradeSuggestionPlayer[];
  gain: number;
  partnerGain: number;
  gainPpg: number;
  partnerGainPpg: number;
  rankBefore: number;
  rankAfter: number;
  partnerRankBefore: number;
  partnerRankAfter: number;
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;
}

function RankMove({ before, after }: { before: number; after: number }) {
  if (before === after) return <span>#{after}</span>;
  const Icon = after < before ? ArrowUp : ArrowDown;
  return (
    <span className={classes.suggestionRank}>
      #{before} → #{after}
      <Icon
        size={12}
        strokeWidth={3}
        className={after < before ? classes.impactUp : classes.impactDown}
      />
    </span>
  );
}

function PlayerLine({
  label,
  players,
  shortName,
}: {
  label: string;
  players: TradeSuggestionPlayer[];
  shortName: (fullName: string) => string;
}) {
  return (
    <div className={classes.suggestionLine}>
      <span className={classes.suggestionLineLabel}>{label}</span>
      <div className={classes.suggestionPlayers}>
        {players.map((player) => (
          <span key={player.fpid} className={classes.suggestionPlayer}>
            <span
              className={`${classes.pill} ${classes.nameBadge}`}
              style={pillStyle(positionColorOrDefault(player.position))}
            >
              {player.position}
            </span>
            <span className={classes.suggestionPlayerName}>{shortName(player.name)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// One suggested trade in the Trade tab's horizontal strip: the partner,
// who you'd send and get, and what it does for you (rest-of-season points
// per week and power-rank move). A tap loads it into the analyzer below;
// long-press opens the full read - both sides' gains and rank moves, every
// player's NFL team and rest-of-season PPG - with its own "Load trade"
// button.
export function GlassTradeSuggestionCard({
  suggestion,
  shortName,
  rosPpgFor,
  active,
  onApply,
}: {
  suggestion: TradeSuggestion;
  shortName: (fullName: string) => string;
  // Rest-of-season PPG off the rosVOR board, for the detail popover.
  rosPpgFor: (fpid: number) => number | undefined;
  // This trade is the one currently loaded below.
  active: boolean;
  onApply: () => void;
}) {
  const names = (players: TradeSuggestionPlayer[]) =>
    players.map((player) => player.name).join(" and ");
  const label =
    `Trade with ${suggestion.partnerName}: send ${names(suggestion.send)}, get ` +
    `${names(suggestion.receive)}. ${signed(suggestion.gainPpg)} points per week for you, ` +
    `power rank ${suggestion.rankBefore} to ${suggestion.rankAfter}`;
  const { cardProps, anchor, expanded, pressing, close } = useExpandableCard(label, {
    onTap: onApply,
  });
  const titleId = useId();

  const playerRows = (players: TradeSuggestionPlayer[]) =>
    players.map((player) => {
      const rosPpg = rosPpgFor(player.fpid);
      return (
        <div key={player.fpid} className={classes.suggestionDetailRow}>
          <span className={classes.pill} style={pillStyle(positionColorOrDefault(player.position))}>
            {player.position}
          </span>
          <span className={classes.suggestionDetailName}>{player.name}</span>
          <span className={classes.suggestionDetailMeta}>
            {[player.team, rosPpg !== undefined ? `${rosPpg.toFixed(1)} ROS` : null]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
      );
    });

  return (
    <>
      <div
        {...cardProps}
        role="button"
        aria-pressed={active}
        className={[
          classes.card,
          classes.pressable,
          classes.suggestionCard,
          active && classes.tradeSelected,
          pressing && classes.pressing,
          expanded && classes.hidden,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className={classes.suggestionPartner} aria-hidden>
          {suggestion.partnerName}
        </div>
        <div aria-hidden>
          <PlayerLine label="Send" players={suggestion.send} shortName={shortName} />
          <PlayerLine label="Get" players={suggestion.receive} shortName={shortName} />
        </div>
        <div
          className={`${classes.statsRow} ${classes.statsRowSplit} ${classes.tradeStats}`}
          aria-hidden
        >
          <span className={`${classes.projSmall} ${classes.impactUp}`}>
            {signed(suggestion.gainPpg)} PPG
          </span>
          <span className={classes.projSmall}>
            <RankMove before={suggestion.rankBefore} after={suggestion.rankAfter} />
          </span>
        </div>
      </div>

      {anchor && (
        <GlassPopover anchor={anchor} onClose={close} labelledBy={titleId}>
          <div className={classes.expandedHeader}>
            <div style={{ minWidth: 0 }}>
              <div id={titleId} className={classes.expandedName}>
                Trade with {suggestion.partnerName}
              </div>
              <div className={classes.gameLine}>
                <span className={classes.gameLineText}>Helps both teams&apos; rest of season</span>
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

          <div>
            <div className={classes.strengthLabel}>You send</div>
            {playerRows(suggestion.send)}
          </div>
          <div>
            <div className={classes.strengthLabel}>You get</div>
            {playerRows(suggestion.receive)}
          </div>

          <div className={classes.statGrid}>
            {[
              { label: "Your PPG", value: signed(suggestion.gainPpg) },
              { label: "Your ROS pts", value: signed(suggestion.gain) },
              {
                label: "Your rank",
                value:
                  suggestion.rankBefore === suggestion.rankAfter
                    ? `#${suggestion.rankAfter}`
                    : `#${suggestion.rankBefore}→#${suggestion.rankAfter}`,
              },
              { label: "Their PPG", value: signed(suggestion.partnerGainPpg) },
              { label: "Their ROS pts", value: signed(suggestion.partnerGain) },
              {
                label: "Their rank",
                value:
                  suggestion.partnerRankBefore === suggestion.partnerRankAfter
                    ? `#${suggestion.partnerRankAfter}`
                    : `#${suggestion.partnerRankBefore}→#${suggestion.partnerRankAfter}`,
              },
            ].map((stat) => (
              <div key={stat.label} className={classes.stat}>
                <div className={classes.statValue}>{stat.value}</div>
                <div className={classes.statLabel}>{stat.label}</div>
              </div>
            ))}
          </div>

          <button
            type="button"
            className={classes.suggestionLoadButton}
            onClick={() => {
              onApply();
              close();
            }}
          >
            Load trade
          </button>
        </GlassPopover>
      )}
    </>
  );
}

// Loading placeholder in the suggestion card's shape.
export function GlassTradeSuggestionSkeleton() {
  return (
    <div className={`${classes.card} ${classes.suggestionCard}`} aria-hidden>
      <span className={classes.skeletonBar} style={{ width: "60%", height: 12 }} />
      <span className={classes.skeletonBar} style={{ width: "85%", height: 17 }} />
      <span className={classes.skeletonBar} style={{ width: "75%", height: 17 }} />
      <span className={classes.skeletonBar} style={{ width: "100%", height: 14 }} />
    </div>
  );
}
