import { useId, useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { Minus, TrendingDown, TrendingUp, X } from "lucide-react";
import { api } from "@infinidata/api";
import { injuryColor } from "@shared/injuryColor";
import { positionColorOrDefault, type Position } from "@shared/positionColors";
import {
  formatPoints,
  formatProj,
  paceFor,
  pillStyle,
  rankPillStyle,
  type GlassMatchupCardData,
  type Pace,
} from "../cards/cardShared";
import { GameLineText } from "../cards/GameLineText";
import { GameStatusGlyph } from "../cards/GameStatusGlyph";
import { GlassPopover } from "../cards/GlassPopover";
import { meterScaleMax } from "../cards/meterScale";
import { PlayerGameLog } from "../cards/PlayerGameLog";
import { PlayerHeadshot } from "../cards/PlayerHeadshot";
import { PointsMeter } from "../cards/PointsMeter";
import { StatGroups, type StatGroup } from "../cards/StatGroups";
import classes from "../cards/GlassMatchupCard.module.css";
import { isAnyGameLive, useNow, type WeekGame } from "../../lib/liveGames";
import { toMatchupCardData } from "../../lib/matchupCardData";
import { LIVE_REFRESH_MS } from "../../lib/matchupSummary";
import { seasonPositionRanks } from "../../lib/seasonPositionRanks";
import type {
  FaabSuggestionsResult,
  RosVorRow,
  StandingsRow,
  TeamRosterRow,
} from "../../types/season";
import { useTradeValues } from "./tradeValues";
import { PlayerTrends } from "./PlayerTrends";

interface NflState {
  season: string;
  week: string;
}

// What only the page knows about the player - everything else the popover
// looks up itself by fpid, so it reads the same on every page.
export interface PlayerPopoverContext {
  // His place in the page's list (Players / Free Agents) - the rank chip
  // before his name, saddlebrown when he's yours.
  listRank?: { rank: number; isMine: boolean } | undefined;
  // His roster slot (Matchup / Team / Trade).
  slot?: string | undefined;
  // He's selected in the Trade analyzer.
  inTrade?: boolean | undefined;
  // The page's own card for the week it's showing (Matchup / Team, which
  // can show past and future weeks) - otherwise the popover builds this
  // week's from the league's live data.
  game?: GlassMatchupCardData | undefined;
  // That week's number, when `game` is for a week other than the current.
  week?: string | undefined;
  // The page's shared meter scale, so the popover's meter matches the
  // cards around it.
  scaleMax?: number | undefined;
}

// The detail card's own label for the state its corner icon stands for.
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

const positionRankLabel = (position: string, rank: number | undefined | null) =>
  rank ? `${position}${rank}` : "—";

// This week's rank, named for which one it is: actual so far while live,
// actual once final, the projection before kickoff.
function weekRankStat(
  game: GlassMatchupCardData | undefined,
  position: string,
  projectedRank: number | undefined,
): { label: string; value: string } {
  if (game?.gameState === "live") {
    return { label: "Live rank", value: positionRankLabel(position, game.weekActualPositionRank) };
  }
  if (game?.gameState === "final") {
    return { label: "Week rank", value: positionRankLabel(position, game.weekActualPositionRank) };
  }
  return {
    label: "Proj rank",
    value: positionRankLabel(position, game?.weekPositionRank ?? projectedRank),
  };
}

// THE player popover - one detail card for a player, whichever page opened
// it (Matchup, Team, Players, Free Agents, Trade). It shows everything any
// page's detail card has ever shown, looked up here by fpid: who he is and
// who rosters him, this week's game (score, meter, pace), this week /
// season / rest-of-season numbers, buy / sell call, a free agent's bid, his
// weekly points and usage (PlayerTrends), and the game log. Pages pass
// only their own context (PlayerPopoverContext). The popover shell,
// placement, and dismissal are GlassPopover's. Without an fpid (the Cards
// sandbox's sample players) it shows only what `context.game` carries.
export function PlayerPopover({
  fpid,
  anchor,
  onClose,
  context = {},
}: {
  fpid: number | undefined;
  anchor: HTMLElement;
  onClose: () => void;
  context?: PlayerPopoverContext;
}) {
  const titleId = useId();
  const { leagueId } = useParams({ strict: false });
  const seasonId = leagueId as Id<"seasons"> | undefined;
  const { isAuthenticated } = useConvexAuth();
  const live = isAuthenticated && seasonId !== undefined && fpid !== undefined;

  const nflState: NflState | null | undefined = useQuery(
    api.nflState.getNflState,
    live ? {} : "skip",
  );
  const week = nflState?.week;
  const standings: StandingsRow[] | undefined = useQuery(
    api.infinileague.season.standings.getStandings,
    live && seasonId ? { seasonId } : "skip",
  );
  // Same board subscription most league pages already hold, so it's shared.
  const board: RosVorRow[] | undefined = useQuery(
    api.rosVor.getRosVorBoard,
    live && seasonId && week ? { seasonId, week } : "skip",
  );
  const weekPoints = useQuery(
    api.rosVor.getWeekPoints,
    live && seasonId && week ? { seasonId, week } : "skip",
  );
  const weekRanks = useQuery(
    api.infinileague.season.matchup.getWeekPositionRanks,
    live && seasonId && week ? { seasonId, week } : "skip",
  );
  const weekGames: WeekGame[] | undefined = useQuery(
    api.sleeper.livePoints.getWeekGames,
    live && nflState && week ? { season: nflState.season, week } : "skip",
  );
  const rookieFpids = useQuery(api.players.getRookieFpids, live ? {} : "skip");
  const byeWeeks: Record<string, number> | undefined = useQuery(
    api.nflSchedule.getByeWeeks,
    live ? {} : "skip",
  );
  const tradeValues = useTradeValues();

  const row = board?.find((entry) => entry.fpid === fpid);
  const seasonRank = useMemo(() => seasonPositionRanks(board), [board]).get(fpid ?? -1);
  const selfTeam = standings?.find((entry) => entry.isSelf);
  const isFreeAgent = row !== undefined && row.rosteredByTeamName === null;
  const faab: FaabSuggestionsResult | undefined = useQuery(
    api.infinileague.season.faabValues.getFaabSuggestions,
    live && seasonId && isFreeAgent
      ? { seasonId, ...(selfTeam ? { teamId: selfTeam.teamId as Id<"seasonTeams"> } : {}) }
      : "skip",
  );
  const bid = faab?.suggestions.find((entry) => entry.fpid === fpid);

  // This week's game: the page's card when it has one, otherwise built
  // from the live slate, his projection, and points so far.
  const now = useNow(isAnyGameLive(weekGames, Date.now()) ? LIVE_REFRESH_MS / 4 : 60 * 1000);
  const actual = weekPoints?.find((entry) => entry.fpid === fpid)?.points;
  const weekRank = weekRanks?.find((entry) => entry.fpid === fpid)?.rank;
  // The current week's game, always - the points chart's latest bar.
  const currentGame: GlassMatchupCardData | undefined =
    row && weekGames
      ? toMatchupCardData(
          {
            fpid: row.fpid,
            name: row.name,
            position: row.position,
            team: row.team,
            projectedPoints: row.weekPpg,
            ...(actual !== undefined ? { actualPoints: actual } : {}),
            ...(row.injury ? { injury: row.injury } : {}),
          } satisfies TeamRosterRow,
          new Map(weekGames.map((entry) => [entry.team, entry])),
          now,
          row,
          weekRank,
          seasonRank,
        )
      : undefined;
  const game = context.game ?? currentGame;

  const name = row?.name ?? game?.name ?? "";
  const position: Position = row?.position ?? game?.position ?? "QB";
  const team = row?.team ?? game?.team ?? null;
  const injury = row?.injury ?? game?.injury;
  const isRookie = (fpid !== undefined && rookieFpids?.includes(fpid)) || game?.isRookie;
  const byeWeek = (team ? byeWeeks?.[team] : undefined) ?? game?.byeWeek;
  const rosRank = row?.positionRank ?? game?.positionRank;
  const owner = row?.rosteredByTeamName;
  const ownerText =
    row === undefined
      ? null
      : owner === null
        ? "Free agent"
        : owner === selfTeam?.name
          ? "Your team"
          : owner;
  const trade = fpid !== undefined ? tradeValues.byFpid?.get(fpid) : undefined;

  const isLive = game?.gameState === "live";
  const isPre = game?.gameState === "pre";
  const showGame = game !== undefined && game.gameState !== "bye";
  const pace = game ? paceFor(game) : undefined;
  const PaceIcon = pace ? PACE_ICON[pace] : null;
  const scaleMax = context.scaleMax ?? (game ? meterScaleMax([game]) : 25);

  const groups: StatGroup[] = [
    {
      label: `Week ${context.week ?? week ?? ""}`.trim(),
      items: [
        {
          label: "Points",
          value:
            game && game.gameState !== "pre" && game.gameState !== "bye"
              ? formatPoints(game.actualPoints)
              : actual !== undefined && !context.game
                ? formatPoints(actual)
                : "—",
        },
        { label: "Proj", value: formatProj(game?.projectedPoints ?? row?.weekPpg) },
        weekRankStat(game, position, row?.weekPositionRank),
        ...(context.slot !== undefined ? [{ label: "Slot", value: context.slot || "—" }] : []),
        { label: "Bye", value: byeWeek ? `Wk ${byeWeek}` : "—" },
      ],
    },
    {
      columns: ["Season", "ROS"],
      rows: [
        {
          label: "PPG",
          values: [
            formatProj(row?.actualPpg ?? game?.seasonPpg),
            formatProj(row?.rosPpg ?? game?.rosPpg),
          ],
        },
        {
          label: "Pos rank",
          values: [
            positionRankLabel(position, seasonRank ?? game?.seasonPositionRank),
            positionRankLabel(position, rosRank),
          ],
        },
        ...(row
          ? [
              {
                label: "Overall",
                values: [
                  row.actualRank > 0 ? `#${row.actualRank}` : "—",
                  row.rosRank > 0 ? `#${row.rosRank}` : "—",
                ],
              },
            ]
          : []),
      ],
    },
    ...(bid
      ? [
          {
            label: "Bidding",
            items: [
              {
                label: "Your bid",
                value: bid.suggestedBid !== null ? `$${bid.suggestedBid}` : "—",
              },
              { label: "Market", value: `$${bid.marketValue}` },
              { label: "Your value", value: bid.myValue !== null ? `$${bid.myValue}` : "—" },
              { label: "Teams in need", value: String(bid.demandCount) },
            ],
          },
        ]
      : []),
  ];

  return (
    <GlassPopover
      anchor={anchor}
      onClose={onClose}
      labelledBy={titleId}
      className={isLive && classes.live}
    >
      <div className={classes.expandedHeader}>
        <PlayerHeadshot fpid={fpid} position={position} team={team} />
        <div style={{ minWidth: 0 }}>
          <div className={classes.teamCardPopoverTitle}>
            {context.listRank && (
              <span className={classes.pill} style={rankPillStyle(context.listRank.isMine)}>
                #{context.listRank.rank}
              </span>
            )}
            <span id={titleId} className={classes.expandedName}>
              {name}
            </span>
          </div>
          <div className={classes.gameLine}>
            {game ? (
              <GameLineText data={game} prefix={team ?? ""} />
            ) : (
              <span className={classes.gameLineText}>{team ?? "FA"}</span>
            )}
          </div>
        </div>
        <button type="button" className={classes.closeButton} onClick={onClose} aria-label="Close">
          <X size={16} strokeWidth={2.5} />
        </button>
      </div>

      <div className={classes.pills}>
        <span className={classes.pill} style={pillStyle(positionColorOrDefault(position))}>
          {position}
          {rosRank ? rosRank : ""}
        </span>
        {injury && (
          <span className={classes.pill} style={pillStyle(injuryColor(injury.status))}>
            {injury.status}
          </span>
        )}
        {isRookie && (
          <span className={classes.pill} style={pillStyle("grape")}>
            Rookie
          </span>
        )}
        {trade?.signal && (
          <span
            className={classes.pill}
            style={pillStyle(trade.signal === "buy" ? "green" : "red")}
            title={
              trade.signal === "buy"
                ? "Ranked well above the market at his position"
                : "Ranked well below the market at his position"
            }
          >
            {trade.signal === "buy" ? "BUY" : "SELL"}
          </span>
        )}
        {context.inTrade && <span className={classes.statusLabel}>In trade</span>}
        {game && game.gameState !== "bye" && (
          <span className={classes.statusLabel}>
            <GameStatusGlyph state={game.gameState} />
            {STATUS_LABEL[game.gameState]}
          </span>
        )}
      </div>

      {ownerText && (
        <div className={classes.gameLine}>
          <span className={classes.gameLineText}>{ownerText}</span>
        </div>
      )}

      {showGame && game && (
        <div>
          <div className={classes.statsRow}>
            {isPre ? (
              <>
                <span className={`${classes.expandedPoints} ${classes.pointsPending}`}>
                  {formatProj(game.projectedPoints)}
                </span>
                <span className={classes.pointsUnit}>projected</span>
              </>
            ) : (
              <>
                <span className={`${classes.expandedPoints} ${classes.playerPoints}`}>
                  {formatPoints(game.actualPoints)}
                </span>
                <span className={classes.pointsUnit}>points</span>
              </>
            )}
          </div>
          <PointsMeter
            actual={game.actualPoints ?? 0}
            projected={game.projectedPoints}
            liveProjected={isLive ? game.liveProjectedPoints : undefined}
            isFinal={game.gameState === "final"}
            scaleMax={scaleMax}
            large
          />
          {/* The meter's legend - each swatch is the same mark it names, so
              the bar reads without color alone. */}
          <div className={classes.legend}>
            {!isPre && (
              <span className={classes.legendItem}>
                <span
                  className={[
                    classes.swatchFill,
                    game.gameState === "final" && pace && classes[`final_${pace}`],
                  ]
                    .filter(Boolean)
                    .join(" ")}
                />
                Actual {formatPoints(game.actualPoints)}
              </span>
            )}
            <span className={classes.legendItem}>
              <span className={classes.swatchTick} />
              Proj {formatProj(game.projectedPoints)}
            </span>
            {isLive && (
              <span className={classes.legendItem}>
                <span
                  className={[classes.swatchGhost, pace && classes[`pace_${pace}`]]
                    .filter(Boolean)
                    .join(" ")}
                />
                Pace {formatProj(game.liveProjectedPoints)}
              </span>
            )}
          </div>
          {pace && PaceIcon && (
            <div className={classes.paceLine}>
              <PaceIcon size={15} strokeWidth={2.5} className={classes[`paceIcon_${pace}`]} />
              {paceSentence(game, pace)}
            </div>
          )}
        </div>
      )}

      <StatGroups groups={groups} />

      {bid && (bid.boostReason || bid.rationale) && (
        <div className={classes.freeAgentPopoverNotes}>
          {bid.boostReason && <p>{bid.boostReason}</p>}
          {bid.rationale && <p>{bid.rationale}</p>}
        </div>
      )}

      {fpid !== undefined && nflState && (
        <PlayerTrends
          fpid={fpid}
          year={nflState.season}
          position={position}
          current={
            week !== undefined
              ? {
                  week: Number(week),
                  state: currentGame?.gameState,
                  actual,
                  projection: row?.weekPpg,
                }
              : undefined
          }
        />
      )}

      {fpid !== undefined && <PlayerGameLog fpid={fpid} position={position} />}
    </GlassPopover>
  );
}
