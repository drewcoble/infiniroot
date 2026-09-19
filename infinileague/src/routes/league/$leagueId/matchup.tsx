import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { Alert, Card, Group, Loader, Progress, Select, Stack, Text, Title } from "@mantine/core";
import { api } from "@infinidata/api";
import { getErrorMessage } from "@shared/errors";
import { POSITION_COLORS } from "@shared/positionColors";
import { useTeamRoster } from "../../../hooks/useTeamRoster";
import { MatchupRosterMatchup } from "../../../components/MatchupRosterMatchup";
import type { SlotLabel, StandingsRow, TeamRosterRow } from "../../../types/season";

export const Route = createFileRoute("/league/$leagueId/matchup")({
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
  field: "projectedPoints" | "actualPoints",
): number {
  if (!rows) return 0;
  return rows.reduce((total, row) => {
    if (!row.slot || !STARTER_SLOTS.has(row.slot)) return total;
    return total + (row[field] ?? 0);
  }, 0);
}

// Rough pregame win read off the two teams' projected totals - a logistic
// curve on the point differential, not a real variance model (no per-player
// score distributions are computed anywhere in this codebase), just enough
// to turn "who's projected ahead" into a percentage instead of a bare point
// gap. WIN_PROB_SCALE tunes how fast it saturates: a 15-point lead reads as
// ~73%, a 30-point lead as ~88%.
const WIN_PROB_SCALE = 15;

// One shade darker than the bare "rb"/"dst" theme colors' own default
// (shade 6) read against this app's light background - dot-shade notation
// so both the bar and its percentage labels below use the exact same color,
// rather than relying on whatever shade a plain color name happens to
// default to.
const WIN_PROB_COLOR_A = `${POSITION_COLORS.RB}.8`;
const WIN_PROB_COLOR_B = `${POSITION_COLORS.DST}.8`;

function winProbability(projA: number, projB: number): number {
  return 1 / (1 + Math.exp(-(projA - projB) / WIN_PROB_SCALE));
}

// While the opponent's roster is still loading, projB reads as a flat 0
// (sumStarterPoints' undefined-rows fallback) - plugged straight into
// winProbability that skews the bar to a false ~100% until the real
// roster lands and it snaps to the true number. The animation below papers
// over that same window with a deliberate "still figuring this out" flip
// through random numbers instead, landing on the real one only once it's
// actually known.
const WIN_PROB_ANIMATION_INTERVAL_MS = 900;
const WIN_PROB_TRANSITION_MS = 650;

function randomWinProb(): number {
  return 35 + Math.random() * 30;
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

  const week = nflState?.week ?? null;

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

  const teamARoster = useTeamRoster(teamAId, week);
  const teamBRoster = useTeamRoster(teamBId, week);

  const projA = sumStarterPoints(teamARoster.rows, "projectedPoints");
  const actualA = sumStarterPoints(teamARoster.rows, "actualPoints");
  const projB = sumStarterPoints(teamBRoster.rows, "projectedPoints");
  const actualB = sumStarterPoints(teamBRoster.rows, "actualPoints");
  const winProbA = winProbability(projA, projB);

  // The real winProbA above isn't trustworthy until both rosters are in -
  // matchupReady gates both effects below on that, not just on an opponent
  // being picked.
  const matchupReady = teamBId !== null && teamBRoster.rows !== undefined;

  const [displayedWinProbA, setDisplayedWinProbA] = useState(() => randomWinProb());

  // Genuinely random every tick (not a handful of fixed "random-looking"
  // values on a loop) so the flip never reads as a repeating pattern -
  // including the starting value itself, so it doesn't land on the same
  // spot every time loading begins.
  useEffect(() => {
    if (teamBId === null || matchupReady) return;
    setDisplayedWinProbA(randomWinProb());
    const interval = setInterval(() => {
      setDisplayedWinProbA(randomWinProb());
    }, WIN_PROB_ANIMATION_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [teamBId, matchupReady]);

  // Once the real number is known, this is the only other place
  // displayedWinProbA ever gets set - the Progress bar's own
  // transitionDuration (see WIN_PROB_TRANSITION_MS) is what makes the jump
  // from wherever the animation left off to this real value read as a
  // smooth glide rather than a snap.
  useEffect(() => {
    if (!matchupReady) return;
    setDisplayedWinProbA(winProbA * 100);
  }, [matchupReady, winProbA]);

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
      <Title order={3}>Matchup</Title>

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

      <Card withBorder padding="lg">
        <Stack gap="md">
          <Group wrap="nowrap" align="center" gap="sm">
            <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
              <Text fw={600} truncate="end">
                {selfTeamName}
              </Text>
              <Text fw={700} size="xl">
                {actualA.toFixed(1)}
              </Text>
              <Text size="xs" c="dimmed">
                Proj {projA.toFixed(1)}
              </Text>
            </Stack>
            <Text c="dimmed" fw={600} style={{ flexShrink: 0 }}>
              VS
            </Text>
            <Stack gap={4} align="flex-end" style={{ flex: 1, minWidth: 0 }}>
              <Text fw={600} truncate="end" ta="right" style={{ maxWidth: "100%" }}>
                {teamBId !== null ? opponentName : "—"}
              </Text>
              <Text fw={700} size="xl">
                {teamBId !== null ? actualB.toFixed(1) : "—"}
              </Text>
              <Text size="xs" c="dimmed">
                {teamBId !== null ? `Proj ${projB.toFixed(1)}` : ""}
              </Text>
            </Stack>
          </Group>

          {teamBId !== null && (
            <Stack gap={4}>
              <Group justify="space-between" wrap="nowrap">
                <Text size="xs" fw={600} c={WIN_PROB_COLOR_A}>
                  {displayedWinProbA.toFixed(0)}%
                </Text>
                <Text size="xs" fw={600} c={WIN_PROB_COLOR_B}>
                  {(100 - displayedWinProbA).toFixed(0)}%
                </Text>
              </Group>
              <Progress.Root size="lg" transitionDuration={WIN_PROB_TRANSITION_MS}>
                <Progress.Section value={displayedWinProbA} color={WIN_PROB_COLOR_A} />
                <Progress.Section value={100 - displayedWinProbA} color={WIN_PROB_COLOR_B} />
              </Progress.Root>
            </Stack>
          )}
        </Stack>
      </Card>

      <Stack gap={8}>
        <MatchupRosterMatchup
          teamARows={teamARoster.rows}
          teamBRows={teamBRoster.rows}
          teamAName={selfTeamName}
          teamBName={opponentName}
        />
      </Stack>
    </Stack>
  );
}
