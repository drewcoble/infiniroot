import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { Alert, Center, Group, Loader, Select, Stack, Text, Title } from "@mantine/core";
import { api } from "@infinidata/api";
import { evaluate } from "@playoffRules/evaluate";
import { GlassSegmented } from "@shared/glass/GlassSegmented";
import { useLeagueApi } from "@shared/league/LeagueApi";
import { useTeamRoster } from "@shared/league/hooks/useTeamRoster";
import { WeekPicker } from "@shared/league/components/WeekPicker";
import { LiveOnlyToggle } from "@shared/league/components/cards/LiveOnlyToggle";
import {
  MatchupRosterMatchup,
  MatchupRosterSkeleton,
} from "@shared/league/components/MatchupRosterMatchup";
import { ErrorMessage } from "@shared/league/components/ErrorMessage";
import {
  GlassMatchupHeader,
  type MatchupHeaderTeam,
} from "@shared/league/components/cards/GlassMatchupHeader";
import { meterScaleMax } from "@shared/league/components/cards/meterScale";
import { seasonPositionRanks } from "@shared/league/lib/seasonPositionRanks";
import { toMatchupCardData } from "@shared/league/lib/matchupCardData";
import { useMatchupGrades } from "@shared/league/lib/matchupDifficulty";
import {
  isStarter,
  LIVE_REFRESH_MS,
  matchupHeaderTeam,
  matchupResult,
  sumStarterPoints,
  winProbability,
} from "@shared/league/lib/matchupSummary";
import { buildShortNames } from "@shared/league/lib/shortPlayerName";
import { optimalProjectedPoints } from "@shared/league/lib/lineupSuggestions";
import {
  isAnyGameLive,
  isGameFinal,
  liveProjection,
  remainingFraction,
  useNow,
  type WeekGame,
} from "@shared/league/lib/liveGames";
import type { RosVorRow, TeamRosterRow } from "@shared/league/types/season";
import { LeagueMatchups } from "../../../components/LeagueMatchups";
import { currentInput, lastFormatWeek } from "../../../lib/engineInput";
import { useSeasonData } from "../../../lib/seasonData";
import { useMySeasons } from "../../../hooks/useMySeasons";
import { standingsRows, weekPairings } from "../../../lib/weekPairings";

const LAST_NFL_WEEK = 18;

interface MatchupSearch {
  week?: number;
  team?: string;
  view?: "league";
}

// Same search params as infinileague's Matchup tab: ?week=N another week,
// ?team= another team on the left, ?view=league every matchup.
export const Route = createFileRoute("/league/$leagueId/matchup")({
  validateSearch: (search: Record<string, unknown>): MatchupSearch => {
    const week = Number(search.week);
    return {
      ...(Number.isInteger(week) && week >= 1 && week <= LAST_NFL_WEEK ? { week } : {}),
      ...(typeof search.team === "string" && search.team ? { team: search.team } : {}),
      ...(search.view === "league" ? { view: "league" as const } : {}),
    };
  },
  component: MatchupPage,
});

interface NflState {
  season: string;
  week: string;
  seasonType: "pre" | "regular" | "post";
}

// infinileague's Matchup tab, for every week of the league's season and
// playoffs: the week's games come from the league's own format (the
// platform schedule, then its group and bracket games), and a game's
// seed or tier bonuses count in its score.
function MatchupPage() {
  const { leagueId } = Route.useParams();
  const seasonId = leagueId as Id<"seasons">;
  const { isAuthenticated } = useConvexAuth();
  const leagueApi = useLeagueApi();
  const { data, error, rules, format, isCustom } = useSeasonData();
  const seasons = useMySeasons();
  const leagueName = seasons?.find((s) => s._id === leagueId)?.name ?? "League";

  const nflState: NflState | null | undefined = useQuery(
    api.nflState.getNflState,
    isAuthenticated ? {} : "skip",
  );

  const state = useMemo(
    () => (data && format ? evaluate(format, currentInput(data, format, rules)) : undefined),
    [data, format, rules],
  );
  const standings = useMemo(
    () => (data && state ? standingsRows(data, state) : undefined),
    [data, state],
  );

  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const leagueView = search.view === "league";
  const myTeamId = data?.teams.find((team) => team.isMine)?.teamId ?? null;
  const teamAId = leagueView ? null : (search.team ?? myTeamId);

  const currentWeek = nflState?.week ?? null;
  const week = search.week !== undefined ? String(search.week) : currentWeek;
  const isCurrentWeek = week === currentWeek;
  const isFutureWeek = week !== null && currentWeek !== null && Number(week) > Number(currentWeek);
  const lastWeek = format ? lastFormatWeek(format) : LAST_NFL_WEEK;
  const goToWeek = (next: number) =>
    void navigate({
      search: (prev) => ({
        ...(prev.team !== undefined ? { team: prev.team } : {}),
        ...(prev.view !== undefined ? { view: prev.view } : {}),
        ...(String(next) === currentWeek ? {} : { week: next }),
      }),
    });
  const viewValue = leagueView
    ? "league"
    : search.team === undefined || search.team === myTeamId
      ? "mine"
      : "other";
  const setView = (next: "mine" | "league" | "other") =>
    void navigate({
      search: (prev) => ({
        ...(prev.week !== undefined ? { week: prev.week } : {}),
        ...(next === "league" ? { view: "league" as const } : {}),
      }),
    });

  const weekGames: WeekGame[] | undefined = useQuery(
    api.sleeper.livePoints.getWeekGames,
    isAuthenticated && nflState && week ? { season: nflState.season, week } : "skip",
  );
  const gamesByTeam = useMemo(
    () => new Map((weekGames ?? []).map((game) => [game.team, game])),
    [weekGames],
  );
  const now = useNow(60 * 1000);
  const anyGameLive = isCurrentWeek && isAnyGameLive(weekGames, now);
  const refreshMs = anyGameLive ? LIVE_REFRESH_MS : null;
  const [liveOnly, setLiveOnly] = useState(false);
  const weekComplete =
    weekGames !== undefined &&
    weekGames.length > 0 &&
    weekGames.every((game) => isGameFinal(game, now));

  const pairings =
    data && format && state && week !== null
      ? weekPairings(data, format, isCustom, state, Number(week))
      : undefined;
  const pairing = pairings?.find((p) => p.teamAId === teamAId || p.teamBId === teamAId);
  const flipped = pairing !== undefined && pairing.teamBId === teamAId;
  const autoOpponentId = pairing ? (flipped ? pairing.teamAId : pairing.teamBId) : null;
  const [bonusA, bonusB] = pairing
    ? flipped
      ? [pairing.bonus[1], pairing.bonus[0]]
      : pairing.bonus
    : [0, 0];

  // No game found (a bye, or a playoff week not set yet): pick one by hand,
  // kept per week.
  const [manualOpponent, setManualOpponent] = useState<{ week: string; teamId: string } | null>(
    null,
  );
  const manualOpponentId =
    manualOpponent !== null && manualOpponent.week === week ? manualOpponent.teamId : null;
  const setManualOpponentId = (teamId: string | null) =>
    setManualOpponent(teamId !== null && week !== null ? { week, teamId } : null);
  const teamBId = pairings === undefined ? null : (autoOpponentId ?? manualOpponentId);
  const opponentPending = pairings === undefined;

  const teamARoster = useTeamRoster(teamAId, week, refreshMs);
  const teamBRoster = useTeamRoster(teamBId, week, refreshMs);

  const vorRows: RosVorRow[] | undefined = useQuery(
    leagueApi.getRosVorBoard,
    isAuthenticated && nflState ? { seasonId, week: nflState.week } : "skip",
  );
  const vorByFpid = useMemo(
    () => new Map((vorRows ?? []).map((row) => [row.fpid, row])),
    [vorRows],
  );
  const seasonPositionRankByFpid = useMemo(() => seasonPositionRanks(vorRows), [vorRows]);
  const weekRanks = useQuery(
    leagueApi.getWeekPositionRanks,
    isAuthenticated && week ? { seasonId, week } : "skip",
  );
  const weekRankByFpid = useMemo(
    () => new Map((weekRanks ?? []).map((entry) => [entry.fpid, entry.rank])),
    [weekRanks],
  );
  const shortName = useMemo(
    () =>
      buildShortNames([
        ...(vorRows ?? []).map((row) => row.name),
        ...(teamARoster.rows ?? []).flatMap((row) => (row.name ? [row.name] : [])),
        ...(teamBRoster.rows ?? []).flatMap((row) => (row.name ? [row.name] : [])),
      ]),
    [vorRows, teamARoster.rows, teamBRoster.rows],
  );

  const liveProjFor = (row: TeamRosterRow) =>
    liveProjection(row, remainingFraction(row.team ? gamesByTeam.get(row.team) : undefined, now));
  const actualFor = (row: TeamRosterRow) => row.actualPoints ?? 0;
  const projA = sumStarterPoints(teamARoster.rows, liveProjFor) + bonusA;
  const actualA = sumStarterPoints(teamARoster.rows, actualFor) + bonusA;
  const projB = sumStarterPoints(teamBRoster.rows, liveProjFor) + bonusB;
  const actualB = sumStarterPoints(teamBRoster.rows, actualFor) + bonusB;
  const winProbA = winProbability(projA, projB);
  const matchupReady = teamBId !== null && teamBRoster.rows !== undefined;

  const matchupGrades = useMatchupGrades(seasonId, week);
  const toCardData = (row: TeamRosterRow) =>
    toMatchupCardData(
      row,
      weekGames ? gamesByTeam : undefined,
      now,
      row.fpid !== undefined ? vorByFpid.get(row.fpid) : undefined,
      row.fpid !== undefined ? weekRankByFpid.get(row.fpid) : undefined,
      row.fpid !== undefined ? seasonPositionRankByFpid.get(row.fpid) : undefined,
      matchupGrades,
    );
  const filledRows = [...(teamARoster.rows ?? []), ...(teamBRoster.rows ?? [])].filter(
    (row) => row.fpid !== undefined,
  );
  const scaleMax = meterScaleMax(filledRows.map(toCardData));
  const anyStarterLive = filledRows.some(
    (row) => isStarter(row) && toCardData(row).gameState === "live",
  );
  const showLiveOnly = liveOnly && anyStarterLive;

  const headerTeam = (
    teamId: string | null,
    name: string,
    rows: TeamRosterRow[] | undefined,
    actual: number,
    proj: number,
  ): MatchupHeaderTeam => {
    const standing = standings?.find((row) => row.teamId === teamId);
    return matchupHeaderTeam(
      name,
      rows,
      actual,
      proj,
      (row) => toCardData(row).gameState,
      standing,
      standing?.logoUrl,
      isFutureWeek && rows ? optimalProjectedPoints(rows) : undefined,
    );
  };

  if (error) return <Alert color="red">{error}</Alert>;
  if (nflState === undefined || !data || format === undefined || !standings) {
    return (
      <Stack gap="md">
        <Title order={3}>Matchup</Title>
        <GlassMatchupHeader teamA="loading" teamB="loading" winProbA={null} />
        <Stack gap={10}>
          <MatchupRosterSkeleton />
        </Stack>
      </Stack>
    );
  }
  if (nflState === null || nflState.seasonType !== "regular") {
    return (
      <Center py="xl">
        <Text c="dimmed">Matchups will be available once the season starts.</Text>
      </Center>
    );
  }

  const teamName = (teamId: string | null) =>
    standings.find((row) => row.teamId === teamId)?.name;
  const teamAName = teamName(teamAId) ?? "Your team";
  const opponentName = teamName(teamBId) ?? "Opponent";
  const playoffWeek =
    format !== null && week !== null && Number(week) > format.regularSeasonEndWeek;
  const teamBOptions = standings
    .filter((row) => row.teamId !== teamAId)
    .map((row) => ({ value: row.teamId, label: row.name }));
  const bonusNote =
    bonusA !== 0 || bonusB !== 0
      ? `Includes the weekly bonus: ${teamAName} +${bonusA}, ${opponentName} +${bonusB}`
      : null;

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center" wrap="nowrap">
        <Title order={3}>{pairing?.label ?? "Matchup"}</Title>
        {week !== null && (
          <WeekPicker
            week={Number(week)}
            currentWeek={currentWeek !== null ? Number(currentWeek) : null}
            lastWeek={lastWeek}
            onChange={goToWeek}
          />
        )}
      </Group>

      <GlassSegmented
        label="Matchups to show"
        value={viewValue}
        onChange={setView}
        compact
        options={[
          { label: "Mine", value: "mine" },
          { label: "League", value: "league" },
        ]}
      />

      {leagueView ? (
        week !== null &&
        (pairings === undefined ? (
          <Center py="xl">
            <Loader />
          </Center>
        ) : pairings === null ? (
          <Text c="dimmed" ta="center" py="xl">
            {playoffWeek ? "This week's playoff games aren't set yet." : "No matchups this week."}
          </Text>
        ) : (
          <LeagueMatchups
            leagueId={leagueId}
            leagueName={leagueName}
            week={week}
            currentWeek={currentWeek}
            pairings={pairings}
            standings={standings}
            gamesByTeam={weekGames ? gamesByTeam : undefined}
            now={now}
            weekComplete={weekComplete}
            weekRankByFpid={weekRankByFpid}
            refreshMs={refreshMs}
          />
        ))
      ) : teamAId === null ? (
        <Text c="dimmed" ta="center" py="xl">
          You aren't on a team in this league - see the League view.
        </Text>
      ) : (
        <>
          {[teamARoster.error, teamBRoster.error].map(
            (message) =>
              message && (
                <Alert key={message} color="red">
                  <ErrorMessage message={message} />
                </Alert>
              ),
          )}

          {!opponentPending && autoOpponentId === null && (
            <Select
              label={
                playoffWeek ? "No playoff game set this week - compare with" : "Opponent this week"
              }
              placeholder="Select a team"
              data={teamBOptions}
              value={manualOpponentId}
              onChange={setManualOpponentId}
              clearable
              w={{ base: "100%", sm: 260 }}
            />
          )}

          <GlassMatchupHeader
            teamA={
              teamARoster.rows === undefined
                ? "loading"
                : headerTeam(teamAId, teamAName, teamARoster.rows, actualA, projA)
            }
            teamB={
              opponentPending || (teamBId !== null && teamBRoster.rows === undefined)
                ? "loading"
                : teamBId !== null
                  ? headerTeam(teamBId, opponentName, teamBRoster.rows, actualB, projB)
                  : null
            }
            winProbA={matchupReady ? winProbA : null}
            result={
              weekComplete && matchupReady
                ? matchupResult(teamAName, actualA, opponentName, actualB)
                : undefined
            }
          />
          {bonusNote && (
            <Text size="xs" c="dimmed" ta="center">
              {bonusNote}
            </Text>
          )}

          {anyStarterLive && (
            <Group justify="flex-end">
              <LiveOnlyToggle on={liveOnly} onChange={setLiveOnly} />
            </Group>
          )}

          <Stack gap={10}>
            {teamARoster.rows === undefined ? (
              <MatchupRosterSkeleton />
            ) : (
              <MatchupRosterMatchup
                liveOnly={showLiveOnly}
                teamARows={teamARoster.rows}
                teamBRows={teamBRoster.rows}
                teamBLoading={opponentPending || teamBId !== null}
                toCardData={toCardData}
                shortName={shortName}
                scaleMax={scaleMax}
              />
            )}
          </Stack>
        </>
      )}
    </Stack>
  );
}
