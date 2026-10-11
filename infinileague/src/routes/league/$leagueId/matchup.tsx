import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { Alert, Group, Select, Stack, Text, Title } from "@mantine/core";
import { api } from "@infinidata/api";
import { getErrorMessage } from "@shared/errors";
import { useTeamRoster } from "../../../hooks/useTeamRoster";
import { WeekPicker } from "../../../components/WeekPicker";
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
import type { RosVorRow, StandingsRow, TeamRosterRow } from "../../../types/season";

// Regular-season weeks the week picker steps through.
const REGULAR_SEASON_WEEKS = 18;

// ?week=N views another week's matchup (past, or upcoming); absent = the
// current NFL week. Anything out of range is dropped rather than erroring.
export const Route = createFileRoute("/league/$leagueId/matchup")({
  validateSearch: (search: Record<string, unknown>): { week?: number } => {
    const week = Number(search.week);
    return Number.isInteger(week) && week >= 1 && week <= REGULAR_SEASON_WEEKS ? { week } : {};
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
// resource (see convex/infinileague/season/matchup.ts's getOpponentForWeek) -
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

  const [teamAId, setTeamAId] = useState<string | null>(null);
  useEffect(() => {
    if (teamAId !== null || !standings) return;
    const self = standings.find((row) => row.isSelf);
    if (self) setTeamAId(self.teamId);
  }, [standings, teamAId]);

  // The week being viewed - ?week= when set, otherwise the current one.
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const currentWeek = nflState?.week ?? null;
  const week = search.week !== undefined ? String(search.week) : currentWeek;
  const isCurrentWeek = week === currentWeek;
  const goToWeek = (next: number) =>
    void navigate({ search: String(next) === currentWeek ? {} : { week: next } });

  const getOpponentForWeek = useAction(api.infinileague.season.matchup.getOpponentForWeek);
  // Tagged with the team/week it was looked up for, same as useTeamRoster -
  // a week change reads as "still looking" immediately rather than briefly
  // keeping last week's opponent. opponentId: null = resolved, but no
  // auto-detected opponent (not provider-linked, or a bye week).
  const opponentKey = teamAId !== null && week !== null ? `${teamAId}:${week}` : null;
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
  // undefined = still looking up the viewed week's opponent.
  const autoOpponentId =
    autoOpponent !== null && autoOpponent.key === opponentKey ? autoOpponent.opponentId : undefined;

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
    liveProjection(
      row.projectedPoints,
      row.actualPoints,
      remainingFraction(row.team ? gamesByTeam.get(row.team) : undefined, now),
      row.position,
    );
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
    name: string,
    rows: TeamRosterRow[] | undefined,
    actual: number,
    proj: number,
  ): MatchupHeaderTeam =>
    matchupHeaderTeam(name, rows, actual, proj, (row) => toCardData(row).gameState);

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

      {opponentError && (
        <Alert color="red" withCloseButton onClose={() => setOpponentError(null)}>
          {opponentError}
        </Alert>
      )}
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
            : headerTeam(selfTeamName, teamARoster.rows, actualA, projA)
        }
        teamB={
          opponentPending || (teamBId !== null && teamBRoster.rows === undefined)
            ? "loading"
            : teamBId !== null
              ? headerTeam(opponentName, teamBRoster.rows, actualB, projB)
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
    </Stack>
  );
}
