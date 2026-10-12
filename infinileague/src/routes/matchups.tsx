import { useEffect, useId, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
// useConvexAuth from convex/react, not @convex-dev/auth/react's - see
// __root.tsx's comment on the same import.
import { useAction, useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { Center, Loader, Stack, Text, Title } from "@mantine/core";
import { api } from "@infinidata/api";
import { getErrorMessage } from "@shared/errors";
import { groupSeasonsByLeague } from "@shared/leagueGroups";
import { PageContainer } from "@shared/PageContainer";
import { AppHeader } from "../components/AppHeader";
import { GlassMatchupHeader } from "../components/cards/GlassMatchupHeader";
import { GlassPopover } from "../components/cards/GlassPopover";
import {
  MatchupSummaryDetail,
  type MatchupDetailTeam,
} from "../components/cards/MatchupSummaryDetail";
import { useExpandableCard } from "../components/cards/useExpandableCard";
import cardClasses from "../components/cards/GlassMatchupCard.module.css";
import detailClasses from "../components/cards/MatchupSummaryDetail.module.css";
import { useTeamRoster } from "../hooks/useTeamRoster";
import { setStoredLeagueId } from "../lib/leagueStorage";
import { toMatchupCardData } from "../lib/matchupCardData";
import {
  LIVE_REFRESH_MS,
  STARTER_SLOTS,
  matchupHeaderTeam,
  matchupResult,
  sumStarterPoints,
  winProbability,
} from "../lib/matchupSummary";
import {
  isAnyGameLive,
  isGameFinal,
  liveProjection,
  remainingFraction,
  useNow,
  type WeekGame,
} from "../lib/liveGames";
import { buildShortNames } from "../lib/shortPlayerName";
import type { LinkedSeason, StandingsRow, TeamRosterRow } from "../types/season";

export const Route = createFileRoute("/matchups")({
  component: MatchupsPage,
});

interface NflState {
  season: string;
  week: string;
  seasonType: "pre" | "regular" | "post";
}

// The NFL-wide slate state every league's card reads the same way - looked
// up once here rather than per league.
interface WeekContext {
  week: string;
  gamesByTeam: Map<string, WeekGame> | undefined;
  now: number;
  refreshMs: number | null;
  weekComplete: boolean;
}

// Every league's matchup for the current week, one score header each (the
// same GlassMatchupHeader the Matchup tab leads with) - reached from the
// header's league switcher. Tapping one opens that league's Matchup tab.
// Only leagues whose latest season is this NFL season are shown - a league
// that hasn't been renewed has no matchup this week.
function MatchupsPage() {
  const { isAuthenticated } = useConvexAuth();
  const currentUser = useQuery(api.users.getCurrentUser);
  const nflState: NflState | null | undefined = useQuery(
    api.nflState.getNflState,
    isAuthenticated ? {} : "skip",
  );
  const seasonsList: LinkedSeason[] | undefined = useQuery(
    api.leagues.listLinkedSeasons,
    isAuthenticated ? {} : "skip",
  );

  const weekGames: WeekGame[] | undefined = useQuery(
    api.sleeper.livePoints.getWeekGames,
    isAuthenticated && nflState ? { season: nflState.season, week: nflState.week } : "skip",
  );
  const gamesByTeam = useMemo(
    () => new Map((weekGames ?? []).map((game) => [game.team, game])),
    [weekGames],
  );
  const now = useNow(60 * 1000);

  const seasons = groupSeasonsByLeague(seasonsList ?? [])
    .map(({ latest }) => latest)
    .filter((season) => nflState && season.year === nflState.season)
    .sort((a, b) => a.name.localeCompare(b.name));

  const content = (() => {
    if (nflState === undefined || seasonsList === undefined) {
      return (
        <Center py="xl">
          <Loader />
        </Center>
      );
    }
    if (nflState === null || nflState.seasonType !== "regular") {
      return (
        <Stack align="center" py="xl" gap={4}>
          <Text c="dimmed">Not currently in an NFL regular season week.</Text>
          <Text c="dimmed" size="sm">
            Matchups will be available once the season starts.
          </Text>
        </Stack>
      );
    }
    if (seasons.length === 0) {
      return (
        <Text c="dimmed" ta="center" py="xl">
          None of your leagues have a {nflState.season} season.
        </Text>
      );
    }
    const context: WeekContext = {
      week: nflState.week,
      gamesByTeam: weekGames ? gamesByTeam : undefined,
      now,
      refreshMs: isAnyGameLive(weekGames, now) ? LIVE_REFRESH_MS : null,
      weekComplete:
        weekGames !== undefined &&
        weekGames.length > 0 &&
        weekGames.every((game) => isGameFinal(game, now)),
    };
    return (
      <Stack gap="lg">
        {seasons.map((season) => (
          <LeagueMatchup
            key={season._id}
            season={season}
            context={context}
            onOpen={() => {
              if (currentUser) setStoredLeagueId(currentUser._id, season._id);
            }}
          />
        ))}
      </Stack>
    );
  })();

  return (
    <PageContainer>
      <Stack gap="md">
        <AppHeader />
        <Title order={3}>
          Matchups{nflState?.seasonType === "regular" ? ` · Week ${nflState.week}` : ""}
        </Title>
        {content}
      </Stack>
    </PageContainer>
  );
}

// One league's score header - the same opponent lookup and starter totals
// as the Matchup tab (routes/league/$leagueId/matchup.tsx), minus the
// per-player cards. No manual opponent picker for a bye week here: the
// right side just stays "Opponent —", and tapping through to the league's
// Matchup tab offers the picker. Long-press (or Space) opens
// MatchupSummaryDetail: both teams' standing, starters playing right now,
// top performers, and upcoming players.
function LeagueMatchup({
  season,
  context,
  onOpen,
}: {
  season: LinkedSeason;
  context: WeekContext;
  onOpen: () => void;
}) {
  const { week, gamesByTeam, now, refreshMs, weekComplete } = context;
  const seasonId = season._id as Id<"seasons">;
  const { isAuthenticated } = useConvexAuth();

  const standings: StandingsRow[] | undefined = useQuery(
    api.infinileague.season.standings.getStandings,
    isAuthenticated ? { seasonId } : "skip",
  );
  const self = standings?.find((row) => row.isSelf);
  const teamAId = self?.teamId ?? null;

  // Same tagged-result pattern as the Matchup tab - undefined = still
  // looking up, null = no opponent this week.
  const getOpponentForWeek = useAction(api.infinileague.season.matchup.getOpponentForWeek);
  const opponentKey = teamAId !== null ? `${teamAId}:${week}` : null;
  const [opponent, setOpponent] = useState<{
    key: string;
    opponentId: string | null;
    error?: string;
  } | null>(null);
  useEffect(() => {
    if (teamAId === null || opponentKey === null) return;
    let cancelled = false;
    getOpponentForWeek({ teamId: teamAId as Id<"seasonTeams">, week })
      .then((result) => {
        if (!cancelled) setOpponent({ key: opponentKey, opponentId: result.opponentTeamId });
      })
      .catch((err) => {
        if (cancelled) return;
        setOpponent({
          key: opponentKey,
          opponentId: null,
          error: getErrorMessage(err, "Failed to look up this week's opponent."),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [teamAId, week, opponentKey, getOpponentForWeek]);
  const current = opponent !== null && opponent.key === opponentKey ? opponent : undefined;
  const teamBId = current?.opponentId ?? null;

  const teamARoster = useTeamRoster(teamAId, week, refreshMs);
  const teamBRoster = useTeamRoster(teamBId, week, refreshMs);

  const liveProjFor = (row: TeamRosterRow) =>
    liveProjection(
      row.projectedPoints,
      row.actualPoints,
      remainingFraction(row.team ? gamesByTeam?.get(row.team) : undefined, now),
      row.position,
    );
  const actualFor = (row: TeamRosterRow) => row.actualPoints ?? 0;
  // This week's actual position rank per player - the detail's top
  // performers show it on their badges ("QB4"), same as the Matchup tab's
  // cards.
  const weekRanks = useQuery(
    api.infinileague.season.matchup.getWeekPositionRanks,
    isAuthenticated ? { seasonId, week } : "skip",
  );
  const weekRankByFpid = useMemo(
    () => new Map((weekRanks ?? []).map((entry) => [entry.fpid, entry.rank])),
    [weekRanks],
  );
  const toCardData = (row: TeamRosterRow) =>
    toMatchupCardData(
      row,
      gamesByTeam,
      now,
      undefined,
      row.fpid !== undefined ? weekRankByFpid.get(row.fpid) : undefined,
    );
  const gameStateFor = (row: TeamRosterRow) => toCardData(row).gameState;

  const nameA = self?.name ?? "Your team";
  const nameB = standings?.find((row) => row.teamId === teamBId)?.name ?? "Opponent";
  const projA = sumStarterPoints(teamARoster.rows, liveProjFor);
  const actualA = sumStarterPoints(teamARoster.rows, actualFor);
  const projB = sumStarterPoints(teamBRoster.rows, liveProjFor);
  const actualB = sumStarterPoints(teamBRoster.rows, actualFor);
  const matchupReady = teamBId !== null && teamBRoster.rows !== undefined;

  const error = current?.error ?? teamARoster.error ?? teamBRoster.error;

  const { cardProps, anchor, expanded, pressing, close } = useExpandableCard<HTMLAnchorElement>(
    `${season.name} matchup: ${nameA} vs. ${teamBId !== null ? nameB : "no opponent"}`,
    { asLink: true },
  );
  const titleId = useId();
  const starters = (rows: TeamRosterRow[] | undefined) =>
    (rows ?? [])
      .filter((row) => row.fpid !== undefined && row.slot && STARTER_SLOTS.has(row.slot))
      .map(toCardData);
  const detailTeams: MatchupDetailTeam[] = [
    { name: nameA, standing: self, starters: starters(teamARoster.rows) },
    ...(teamBId !== null
      ? [
          {
            name: nameB,
            standing: standings?.find((row) => row.teamId === teamBId),
            starters: starters(teamBRoster.rows),
          },
        ]
      : []),
  ];
  const shortName = buildShortNames(
    [...(teamARoster.rows ?? []), ...(teamBRoster.rows ?? [])].flatMap((row) =>
      row.name ? [row.name] : [],
    ),
  );

  return (
    <Stack gap={6}>
      <Text size="sm" fw={600} c="dimmed" truncate>
        {season.name}
      </Text>
      {standings !== undefined && !self ? (
        <Text size="sm" c="dimmed">
          Your team in this league isn&apos;t linked yet.
        </Text>
      ) : (
        <Link
          to="/league/$leagueId/matchup"
          params={{ leagueId: season._id }}
          {...cardProps}
          onClick={(event) => {
            cardProps.onClick(event);
            if (!event.defaultPrevented) onOpen();
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
            teamA={
              teamARoster.rows === undefined
                ? "loading"
                : matchupHeaderTeam(nameA, teamARoster.rows, actualA, projA, gameStateFor)
            }
            teamB={
              current === undefined || (teamBId !== null && teamBRoster.rows === undefined)
                ? "loading"
                : teamBId !== null
                  ? matchupHeaderTeam(nameB, teamBRoster.rows, actualB, projB, gameStateFor)
                  : null
            }
            winProbA={matchupReady ? winProbability(projA, projB) : null}
            result={
              weekComplete && matchupReady
                ? matchupResult(nameA, actualA, nameB, actualB)
                : undefined
            }
          />
        </Link>
      )}
      {anchor && (
        <GlassPopover anchor={anchor} onClose={close} labelledBy={titleId}>
          <MatchupSummaryDetail
            title={season.name}
            titleId={titleId}
            subtitle={`Week ${week}`}
            teams={detailTeams}
            shortName={shortName}
            onClose={close}
          />
        </GlassPopover>
      )}
      {error && (
        <Text size="xs" c="red">
          {error}
        </Text>
      )}
    </Stack>
  );
}
