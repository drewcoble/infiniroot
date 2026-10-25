import { useId } from "react";
import { Link } from "@tanstack/react-router";
import { GlassMatchupHeader, type MatchupHeaderTeam } from "./cards/GlassMatchupHeader";
import { GlassPopover } from "./cards/GlassPopover";
import { MatchupSummaryDetail, type MatchupDetailTeam } from "./cards/MatchupSummaryDetail";
import { useExpandableCard } from "./cards/useExpandableCard";
import cardClasses from "./cards/GlassMatchupCard.module.css";
import detailClasses from "./cards/MatchupSummaryDetail.module.css";
import { toMatchupCardData } from "../lib/matchupCardData";
import {
  STARTER_SLOTS,
  matchupHeaderTeam,
  matchupResult,
  sumStarterPoints,
  winProbability,
} from "../lib/matchupSummary";
import { liveProjection, remainingFraction, type WeekGame } from "../lib/liveGames";
import { buildShortNames } from "../lib/shortPlayerName";
import type { StandingsRow, TeamRosterRow } from "../types/season";

export interface MatchupScoreSide {
  name: string;
  // undefined = still loading.
  rows: TeamRosterRow[] | undefined;
  // Adds the rank badge and the detail's record - left out for a guillotine
  // league, which has no head-to-head standings.
  standing?: StandingsRow | undefined;
  logoUrl?: string | undefined;
}

// One matchup's score header as a link into the league's Matchup tab -
// shared by the cross-league Matchups page (routes/matchups.tsx) and the
// Matchup tab's league view. Long-press (or Space) opens
// MatchupSummaryDetail: both teams' standing, starters playing right now,
// top performers, and upcoming players.
export function MatchupScoreCard({
  leagueId,
  search,
  title,
  ariaLabel,
  week,
  teamA,
  teamB,
  gamesByTeam,
  now,
  weekComplete,
  weekRankByFpid,
  headToHead,
  onOpen,
}: {
  leagueId: string;
  // The Matchup tab's search params for this matchup (whose side, which
  // week) - empty opens your own current matchup.
  search: { week?: number; team?: string };
  // The detail popover's title.
  title: string;
  ariaLabel: string;
  week: string;
  teamA: MatchupScoreSide;
  // null = no opponent this week, "loading" = still looking one up.
  teamB: MatchupScoreSide | null | "loading";
  gamesByTeam: Map<string, WeekGame> | undefined;
  now: number;
  weekComplete: boolean;
  // This week's actual position rank per player - the detail's top
  // performers show it on their badges ("QB4").
  weekRankByFpid: Map<number, number>;
  headToHead: boolean;
  onOpen?: () => void;
}) {
  const liveProjFor = (row: TeamRosterRow) =>
    liveProjection(row, remainingFraction(row.team ? gamesByTeam?.get(row.team) : undefined, now));
  const actualFor = (row: TeamRosterRow) => row.actualPoints ?? 0;
  const toCardData = (row: TeamRosterRow) =>
    toMatchupCardData(
      row,
      gamesByTeam,
      now,
      undefined,
      row.fpid !== undefined ? weekRankByFpid.get(row.fpid) : undefined,
    );
  const gameStateFor = (row: TeamRosterRow) => toCardData(row).gameState;

  const opponent = teamB !== "loading" ? teamB : null;
  const projA = sumStarterPoints(teamA.rows, liveProjFor);
  const actualA = sumStarterPoints(teamA.rows, actualFor);
  const projB = sumStarterPoints(opponent?.rows, liveProjFor);
  const actualB = sumStarterPoints(opponent?.rows, actualFor);
  const matchupReady = opponent !== null && opponent.rows !== undefined;

  const { cardProps, anchor, expanded, pressing, close } = useExpandableCard<HTMLAnchorElement>(
    ariaLabel,
    { asLink: true },
  );
  const titleId = useId();

  const headerTeam = (side: MatchupScoreSide, actual: number, proj: number): MatchupHeaderTeam =>
    matchupHeaderTeam(
      side.name,
      side.rows,
      actual,
      proj,
      gameStateFor,
      headToHead ? side.standing : undefined,
      side.logoUrl,
    );
  const starters = (rows: TeamRosterRow[] | undefined) =>
    (rows ?? [])
      .filter((row) => row.fpid !== undefined && row.slot && STARTER_SLOTS.has(row.slot))
      .map(toCardData);
  const detailTeams: MatchupDetailTeam[] = [
    { name: teamA.name, standing: teamA.standing, starters: starters(teamA.rows) },
    ...(opponent !== null
      ? [{ name: opponent.name, standing: opponent.standing, starters: starters(opponent.rows) }]
      : []),
  ];
  const shortName = buildShortNames(
    [...(teamA.rows ?? []), ...(opponent?.rows ?? [])].flatMap((row) =>
      row.name ? [row.name] : [],
    ),
  );

  return (
    <>
      <Link
        to="/league/$leagueId/matchup"
        params={{ leagueId }}
        search={search}
        {...cardProps}
        onClick={(event) => {
          cardProps.onClick(event);
          if (!event.defaultPrevented) onOpen?.();
        }}
        className={[
          detailClasses.cardLink,
          cardClasses.pressable,
          pressing && cardClasses.pressing,
          expanded && cardClasses.hidden,
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ display: "block", color: "inherit", textDecoration: "none" }}
      >
        <GlassMatchupHeader
          teamA={teamA.rows === undefined ? "loading" : headerTeam(teamA, actualA, projA)}
          teamB={
            teamB === "loading" || (opponent !== null && opponent.rows === undefined)
              ? "loading"
              : opponent !== null
                ? headerTeam(opponent, actualB, projB)
                : null
          }
          winProbA={matchupReady ? winProbability(projA, projB) : null}
          result={
            weekComplete && matchupReady && opponent !== null
              ? matchupResult(teamA.name, actualA, opponent.name, actualB)
              : undefined
          }
        />
      </Link>
      {anchor && (
        <GlassPopover anchor={anchor} onClose={close} labelledBy={titleId}>
          <MatchupSummaryDetail
            title={title}
            titleId={titleId}
            subtitle={`Week ${week}`}
            teams={detailTeams}
            headToHead={headToHead}
            shortName={shortName}
            onClose={close}
          />
        </GlassPopover>
      )}
    </>
  );
}
