import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { Alert, Group, Select, Stack, Text, Title } from "@mantine/core";
import { api } from "@infinidata/api";
import { getErrorMessage } from "@shared/errors";
import { useGuillotineOpponent } from "../../../hooks/useGuillotineOpponent";
import { useTeamRoster } from "../../../hooks/useTeamRoster";
import { WeekPicker } from "../../../components/WeekPicker";
import { GlassSegmented } from "../../../components/cards/GlassSegmented";
import { LeagueMatchupsList } from "../../../components/LeagueMatchupsList";
import { LiveOnlyToggle } from "../../../components/cards/LiveOnlyToggle";
import {
  MatchupRosterMatchup,
  MatchupRosterSkeleton,
} from "../../../components/MatchupRosterMatchup";
import { seasonPositionRanks } from "../../../lib/seasonPositionRanks";
import { toMatchupCardData } from "../../../lib/matchupCardData";
import {
  isStarter,
  LIVE_REFRESH_MS,
  matchupHeaderTeam,
  matchupResult,
  sumStarterPoints,
  winProbability,
} from "../../../lib/matchupSummary";
import {
  GlassMatchupHeader,
  type MatchupHeaderTeam,
} from "../../../components/cards/GlassMatchupHeader";
import { meterScaleMax } from "../../../components/cards/meterScale";
import { buildShortNames } from "../../../lib/shortPlayerName";
import {
  isAnyGameLive,
  isGameFinal,
  liveProjection,
  remainingFraction,
  useNow,
  type WeekGame,
} from "../../../lib/liveGames";
import type {
  LinkedSeason,
  RosVorRow,
  StandingsRow,
  TeamRosterRow,
} from "../../../types/season";

// Regular-season weeks the week picker steps through.
const REGULAR_SEASON_WEEKS = 18;

interface MatchupSearch {
  week?: number;
  team?: string;
  view?: "league";
}

// ?week=N views another week's matchup (past, or upcoming); absent = the
// current NFL week. ?team= puts another team on the left (a matchup opened
// from the League view); absent = your own. ?view=league lists every
// matchup in the league instead. Anything invalid is dropped rather than
// erroring.
export const Route = createFileRoute("/league/$leagueId/matchup")({
  validateSearch: (search: Record<string, unknown>): MatchupSearch => {
    const week = Number(search.week);
    return {
      ...(Number.isInteger(week) && week >= 1 && week <= REGULAR_SEASON_WEEKS ? { week } : {}),
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

// Head-to-head view of this week's matchup: your own roster on the left,
// this week's opponent on the right, lined up slot-by-slot (see
// MatchupRosterMatchup.tsx) same layout as the Trade tab, minus the
// selection/power-rankings machinery that's specific to building a trade.
// Opponent is auto-detected via Sleeper's matchup_id or Yahoo's scoreboard
// resource (see convex/infinileague/season/matchup.ts's getOpponentForWeek),
// or in a guillotine league is the lowest projected team (see
// useGuillotineOpponent) -
// a genuine bye week (an odd team count leaves one roster with no matchup
// some weeks) has no real opponent to detect either way, so that falls back
// to a manual team picker rather than blocking the page.
function MatchupPage() {
  const { leagueId } = Route.useParams();
  const seasonId = leagueId as Id<"seasons">;
  const { isAuthenticated } = useConvexAuth();

  const nflState: NflState | null | undefined = useQuery(
    api.nflState.getNflState,
    isAuthenticated ? {} : "skip",
  );

  const standings: StandingsRow[] | undefined = useQuery(
    api.infinileague.season.standings.getStandings,
    isAuthenticated ? { seasonId } : "skip",
  );
  // A guillotine league has no head-to-head games, so no meaningful rank -
  // the header leaves the rank badges out.
  const seasonsList: LinkedSeason[] | undefined = useQuery(
    api.leagues.listLinkedSeasons,
    isAuthenticated ? {} : "skip",
  );
  const leagueSeason = seasonsList?.find((season) => season._id === leagueId);
  const isGuillotine = leagueSeason?.leagueType === "guillotine";
  // The opponent lookup waits on this - a guillotine league's opponent
  // comes from useGuillotineOpponent instead of the provider.
  const leagueTypeKnown = seasonsList !== undefined;

  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  // League view (every matchup) vs. one matchup - a guillotine league has
  // no pairings, so it only ever gets the one.
  const leagueView = search.view === "league" && !isGuillotine;
  const selfTeamId = standings?.find((row) => row.isSelf)?.teamId ?? null;
  // The left-hand team: ?team= when a matchup was opened from the League
  // view, otherwise your own. Null in the League view, so the single
  // matchup's lookups below stay idle.
  const teamAId = leagueView ? null : (search.team ?? selfTeamId);

  // The week being viewed - ?week= when set, otherwise the current one.
  // Changing weeks keeps the view and team.
  const currentWeek = nflState?.week ?? null;
  const week = search.week !== undefined ? String(search.week) : currentWeek;
  const isCurrentWeek = week === currentWeek;
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
    : search.team === undefined || search.team === selfTeamId
      ? "mine"
      : "other";
  const setView = (next: "mine" | "league" | "other") =>
    void navigate({
      search: (prev) => ({
        ...(prev.week !== undefined ? { week: prev.week } : {}),
        ...(next === "league" ? { view: "league" as const } : {}),
      }),
    });

  // The viewed week's slate - opponent/kickoff per NFL team, plus live
  // game status from the 2-minute poll (see convex/sleeper/livePoints.ts).
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
  // Every game in the viewed week is over - the header shows the result
  // instead of a win probability.
  const weekComplete =
    weekGames !== undefined &&
    weekGames.length > 0 &&
    weekGames.every((game) => isGameFinal(game, now));

  const getOpponentForWeek = useAction(api.infinileague.season.matchup.getOpponentForWeek);
  // Tagged with the team/week it was looked up for, same as useTeamRoster -
  // a week change reads as "still looking" immediately rather than briefly
  // keeping last week's opponent. opponentId: null = resolved, but no
  // auto-detected opponent (not provider-linked, or a bye week).
  const opponentKey =
    teamAId !== null && week !== null && leagueTypeKnown && !isGuillotine
      ? `${teamAId}:${week}`
      : null;
  const [autoOpponent, setAutoOpponent] = useState<{
    key: string;
    opponentId: string | null;
  } | null>(null);
  const [opponentError, setOpponentError] = useState<string | null>(null);
  useEffect(() => {
    if (teamAId === null || week === null || opponentKey === null) return;
    let cancelled = false;
    getOpponentForWeek({ teamId: teamAId as Id<"seasonTeams">, week })
      .then((result) => {
        if (!cancelled) setAutoOpponent({ key: opponentKey, opponentId: result.opponentTeamId });
      })
      .catch((err) => {
        if (cancelled) return;
        setOpponentError(getErrorMessage(err, "Failed to look up this week's opponent."));
        setAutoOpponent({ key: opponentKey, opponentId: null });
      });
    return () => {
      cancelled = true;
    };
  }, [teamAId, week, opponentKey, getOpponentForWeek]);
  // A guillotine league's opponent is the lowest live-projected other team.
  const guillotine = useGuillotineOpponent(
    leagueTypeKnown && isGuillotine ? seasonId : null,
    week,
    weekGames,
    now,
    refreshMs,
  );
  // undefined = still looking up the viewed week's opponent.
  const autoOpponentId = isGuillotine
    ? guillotine.opponentId
    : autoOpponent !== null && autoOpponent.key === opponentKey
      ? autoOpponent.opponentId
      : undefined;

  // Only ever read from once autoOpponentId resolves to null (see above) -
  // the manual Select stays hidden while auto-detection is still pending so
  // it doesn't flash on screen for the common Sleeper-linked case. Kept per
  // week, so a manual pick for one bye week doesn't follow you to others.
  const [manualOpponent, setManualOpponent] = useState<{ week: string; teamId: string } | null>(
    null,
  );
  const manualOpponentId =
    manualOpponent !== null && manualOpponent.week === week ? manualOpponent.teamId : null;
  const setManualOpponentId = (teamId: string | null) =>
    setManualOpponent(teamId !== null && week !== null ? { week, teamId } : null);
  const teamBId = autoOpponentId === undefined ? null : (autoOpponentId ?? manualOpponentId);
  const opponentPending = autoOpponentId === undefined;

  const teamARoster = useTeamRoster(teamAId, week, refreshMs);
  const teamBRoster = useTeamRoster(teamBId, week, refreshMs);

  // Season/ROS context for each card's detail view (season and ROS PPG,
  // ROS and projected week position ranks) - the same board the Trade tab
  // reads. Also the league-wide name pool the cards' short names are
  // collision-checked against ("Bijan Robinson" vs. "Brian Robinson Jr."
  // never both shorten to "B. Robinson"). Always the current week's board,
  // whichever week is being viewed - it's the latest season/ROS picture,
  // and future weeks have no board yet.
  const vorRows: RosVorRow[] | undefined = useQuery(
    api.rosVor.getRosVorBoard,
    isAuthenticated && nflState ? { seasonId, week: nflState.week } : "skip",
  );
  const vorByFpid = useMemo(
    () => new Map((vorRows ?? []).map((row) => [row.fpid, row])),
    [vorRows],
  );
  const seasonPositionRankByFpid = useMemo(() => seasonPositionRanks(vorRows), [vorRows]);

  // This week's actual position rank per player (the badge's "RB3" once a
  // game starts) - re-ranked on every live poll server-side.
  const weekRanks = useQuery(
    api.infinileague.season.matchup.getWeekPositionRanks,
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

  // Actual points so far plus each starter's projection scaled by how much
  // of their game is left - the plain pregame projection before kickoff,
  // the actual score once their game is final.
  const liveProjFor = (row: TeamRosterRow) =>
    liveProjection(row, remainingFraction(row.team ? gamesByTeam.get(row.team) : undefined, now));
  const actualFor = (row: TeamRosterRow) => row.actualPoints ?? 0;
  const projA = sumStarterPoints(teamARoster.rows, liveProjFor);
  const actualA = sumStarterPoints(teamARoster.rows, actualFor);
  const projB = sumStarterPoints(teamBRoster.rows, liveProjFor);
  const actualB = sumStarterPoints(teamBRoster.rows, actualFor);
  const winProbA = winProbability(projA, projB);

  // Not trustworthy until both rosters are actually in - before that, projB
  // reads as a flat 0 (sumStarterPoints' undefined-rows fallback), which
  // winProbability skews to a false ~100% rather than a real number. Gates
  // the win-probability section below so it only ever shows once this is
  // true, rather than a wrong number that then jumps to the right one.
  const matchupReady = teamBId !== null && teamBRoster.rows !== undefined;

  const toCardData = (row: TeamRosterRow) =>
    toMatchupCardData(
      row,
      weekGames ? gamesByTeam : undefined,
      now,
      row.fpid !== undefined ? vorByFpid.get(row.fpid) : undefined,
      row.fpid !== undefined ? weekRankByFpid.get(row.fpid) : undefined,
      row.fpid !== undefined ? seasonPositionRankByFpid.get(row.fpid) : undefined,
    );
  const filledRows = [...(teamARoster.rows ?? []), ...(teamBRoster.rows ?? [])].filter(
    (row) => row.fpid !== undefined,
  );
  const scaleMax = meterScaleMax(filledRows.map(toCardData));
  // "Live only" - only offered (and only applied) while a starter on either
  // side is in a live game, so it can't strand the page empty once their
  // games end.
  const anyStarterLive = filledRows.some(
    (row) => isStarter(row) && toCardData(row).gameState === "live",
  );
  const showLiveOnly = liveOnly && anyStarterLive;

  // Starters whose games are underway / not yet started, for the header.
  const headerTeam = (
    teamId: string | null,
    name: string,
    rows: TeamRosterRow[] | undefined,
    actual: number,
    proj: number,
  ): MatchupHeaderTeam =>
    matchupHeaderTeam(
      name,
      rows,
      actual,
      proj,
      (row) => toCardData(row).gameState,
      isGuillotine ? undefined : standings?.find((row) => row.teamId === teamId),
      standings?.find((row) => row.teamId === teamId)?.logoUrl,
    );

  // Header and rows hold their shape with glass skeletons while loading,
  // rather than a bare spinner or blank column.
  if (nflState === undefined || standings === undefined) {
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
      <Stack align="center" py="xl" gap={4}>
        <Text c="dimmed">Not currently in an NFL regular season week.</Text>
        <Text c="dimmed" size="sm">
          Matchups will be available once the season starts.
        </Text>
      </Stack>
    );
  }

  const selfTeamName = standings.find((row) => row.teamId === teamAId)?.name ?? "Your team";
  const opponentName = standings.find((row) => row.teamId === teamBId)?.name ?? "Opponent";

  const teamBOptions = standings
    .filter((row) => row.teamId !== teamAId)
    .map((row) => ({ value: row.teamId, label: row.name }));

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center" wrap="nowrap">
        <Title order={3}>Matchup</Title>
        {week !== null && (
          <WeekPicker
            week={Number(week)}
            currentWeek={currentWeek !== null ? Number(currentWeek) : null}
            lastWeek={REGULAR_SEASON_WEEKS}
            onChange={goToWeek}
          />
        )}
      </Group>

      {!isGuillotine && (
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
      )}

      {leagueView ? (
        week !== null && (
          <LeagueMatchupsList
            leagueId={leagueId}
            leagueName={leagueSeason?.name ?? "League"}
            week={week}
            currentWeek={currentWeek}
            standings={standings}
            gamesByTeam={weekGames ? gamesByTeam : undefined}
            now={now}
            weekComplete={weekComplete}
            weekRankByFpid={weekRankByFpid}
            refreshMs={refreshMs}
          />
        )
      ) : (
        <>
          {opponentError && (
            <Alert color="red" withCloseButton onClose={() => setOpponentError(null)}>
              {opponentError}
            </Alert>
          )}
          {guillotine.error && <Alert color="red">{guillotine.error}</Alert>}
          {teamARoster.error && <Alert color="red">{teamARoster.error}</Alert>}
          {teamBRoster.error && <Alert color="red">{teamBRoster.error}</Alert>}

          {autoOpponentId === null && (
            <Select
              label="Opponent this week"
              placeholder="Select a team"
              data={teamBOptions}
              value={manualOpponentId}
              onChange={setManualOpponentId}
              clearable
              w={{ base: "100%", sm: 220 }}
            />
          )}

          <GlassMatchupHeader
            teamA={
              teamARoster.rows === undefined
                ? "loading"
                : headerTeam(teamAId, selfTeamName, teamARoster.rows, actualA, projA)
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
                ? matchupResult(selfTeamName, actualA, opponentName, actualB)
                : undefined
            }
          />

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
