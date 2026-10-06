import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@infinidata/api";
import { getErrorMessage } from "@shared/errors";
import { useTeamRoster } from "../../../hooks/useTeamRoster";
import { MatchupRosterMatchup } from "../../../components/MatchupRosterMatchup";
import { toMatchupCardData } from "../../../lib/matchupCardData";
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
import type { RosVorRow, SlotLabel, StandingsRow, TeamRosterRow } from "../../../types/season";

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

// Starting lineup slots only - excludes BENCH/IR/TAXI, whose points don't
// count toward the team's total for the week. Same list teams/$teamId.tsx's
// own sumStarterPoints uses for the "My Team" header card.
const STARTER_SLOTS = new Set<SlotLabel>([
  "QB",
  "SUPERFLEX",
  "RB",
  "WR",
  "FLEX",
  "TE",
  "DST",
  "K",
]);

function sumStarterPoints(
  rows: TeamRosterRow[] | undefined,
  pointsFor: (row: TeamRosterRow) => number,
): number {
  if (!rows) return 0;
  return rows.reduce((total, row) => {
    if (!row.slot || !STARTER_SLOTS.has(row.slot)) return total;
    return total + pointsFor(row);
  }, 0);
}

// How often the rosters' actual points are re-fetched from Sleeper/Yahoo
// while a game is being played - matches the live poll's own cadence
// (convex/crons.ts), which is what moves the game clocks.
const LIVE_REFRESH_MS = 2 * 60 * 1000;

// Rough win read off the two teams' live-projected totals - a logistic
// curve on the point differential, not a real variance model (no per-player
// score distributions are computed anywhere in this codebase), just enough
// to turn "who's projected ahead" into a percentage instead of a bare point
// gap. WIN_PROB_SCALE tunes how fast it saturates: a 15-point lead reads as
// ~73%, a 30-point lead as ~88%.
const WIN_PROB_SCALE = 15;

function winProbability(projA: number, projB: number): number {
  return 1 / (1 + Math.exp(-(projA - projB) / WIN_PROB_SCALE));
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
  // undefined = not resolved yet, null = resolved but no auto-detected
  // opponent (not Sleeper-linked, or a bye week), a teamId = found.
  const [autoOpponentId, setAutoOpponentId] = useState<string | null | undefined>(undefined);
  const [opponentError, setOpponentError] = useState<string | null>(null);
  useEffect(() => {
    if (teamAId === null || week === null) return;
    setAutoOpponentId(undefined);
    getOpponentForWeek({ teamId: teamAId as Id<"seasonTeams">, week })
      .then((result) => setAutoOpponentId(result.opponentTeamId))
      .catch((err) => {
        setOpponentError(getErrorMessage(err, "Failed to look up this week's opponent."));
        setAutoOpponentId(null);
      });
  }, [teamAId, week, getOpponentForWeek]);

  // Only ever read from once autoOpponentId resolves to null (see above) -
  // the manual Select stays hidden while auto-detection is still pending so
  // it doesn't flash on screen for the common Sleeper-linked case.
  const [manualOpponentId, setManualOpponentId] = useState<string | null>(null);
  const teamBId = autoOpponentId ?? manualOpponentId;

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
  const refreshMs = isCurrentWeek && isAnyGameLive(weekGames, now) ? LIVE_REFRESH_MS : null;
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
    );
  const filledRows = [...(teamARoster.rows ?? []), ...(teamBRoster.rows ?? [])].filter(
    (row) => row.fpid !== undefined,
  );
  const scaleMax = meterScaleMax(filledRows.map(toCardData));

  // Starters whose games are underway / not yet started, for the header.
  const headerTeam = (
    name: string,
    rows: TeamRosterRow[] | undefined,
    actual: number,
    proj: number,
  ): MatchupHeaderTeam => {
    const states = (rows ?? [])
      .filter((row) => row.fpid !== undefined && row.slot && STARTER_SLOTS.has(row.slot))
      .map((row) => toCardData(row).gameState);
    return {
      name,
      actualPoints: actual,
      projectedPoints: proj,
      liveCount: states.filter((state) => state === "live").length,
      toPlayCount: states.filter((state) => state === "pre").length,
    };
  };

  if (nflState === undefined || standings === undefined) {
    return <Loader />;
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

  if (teamAId === null || teamARoster.rows === undefined) {
    return <Loader />;
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
          <Group gap={4} wrap="nowrap">
            {!isCurrentWeek && currentWeek !== null && (
              <Button
                variant="subtle"
                size="compact-sm"
                onClick={() => goToWeek(Number(currentWeek))}
              >
                This week
              </Button>
            )}
            <ActionIcon
              variant="subtle"
              aria-label="Previous week"
              disabled={Number(week) <= 1}
              onClick={() => goToWeek(Number(week) - 1)}
            >
              <ChevronLeft size={18} />
            </ActionIcon>
            <Text fw={600} style={{ minWidth: 64, textAlign: "center" }}>
              Week {week}
            </Text>
            <ActionIcon
              variant="subtle"
              aria-label="Next week"
              disabled={Number(week) >= REGULAR_SEASON_WEEKS}
              onClick={() => goToWeek(Number(week) + 1)}
            >
              <ChevronRight size={18} />
            </ActionIcon>
          </Group>
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
        teamA={headerTeam(selfTeamName, teamARoster.rows, actualA, projA)}
        teamB={teamBId !== null ? headerTeam(opponentName, teamBRoster.rows, actualB, projB) : null}
        winProbA={matchupReady ? winProbA : null}
        result={
          weekComplete && matchupReady
            ? actualA === actualB
              ? "Final · Tied"
              : `Final · ${actualA > actualB ? selfTeamName : opponentName} won by ${Math.abs(actualA - actualB).toFixed(2)}`
            : undefined
        }
      />

      <Stack gap={10}>
        <MatchupRosterMatchup
          teamARows={teamARoster.rows}
          teamBRows={teamBRoster.rows}
          toCardData={toCardData}
          shortName={shortName}
          scaleMax={scaleMax}
        />
      </Stack>
    </Stack>
  );
}
