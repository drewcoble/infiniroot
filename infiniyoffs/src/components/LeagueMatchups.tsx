import { Alert, Stack, Text } from "@mantine/core";
import { GlassMatchupHeader } from "@shared/league/components/cards/GlassMatchupHeader";
import { MatchupScoreCard } from "@shared/league/components/MatchupScoreCard";
import { ErrorMessage } from "@shared/league/components/ErrorMessage";
import type { WeekGame } from "@shared/league/lib/liveGames";
import type { StandingsRow } from "@shared/league/types/season";
import { useWeekLineups } from "../hooks/useWeekLineups";
import type { WeekPairing } from "../lib/weekPairings";

// Every matchup in the league for one week - infinileague's League view,
// with the pairings from the league's own format. One score card per
// game, your own first; tapping one opens it in the Mine view.
export function LeagueMatchups({
  leagueId,
  leagueName,
  week,
  currentWeek,
  pairings,
  standings,
  gamesByTeam,
  now,
  weekComplete,
  weekRankByFpid,
  refreshMs,
}: {
  leagueId: string;
  leagueName: string;
  week: string;
  currentWeek: string | null;
  pairings: WeekPairing[];
  standings: StandingsRow[];
  gamesByTeam: Map<string, WeekGame> | undefined;
  now: number;
  weekComplete: boolean;
  weekRankByFpid: Map<number, number>;
  refreshMs: number | null;
}) {
  const { lineups, error } = useWeekLineups(leagueId, week, refreshMs);
  if (error) return <Alert color="red"><ErrorMessage message={error} /></Alert>;
  if (pairings.length === 0) {
    return (
      <Text c="dimmed" ta="center" py="xl">
        No matchups this week.
      </Text>
    );
  }
  if (!lineups) {
    return (
      <Stack gap="sm">
        {pairings.map((_, index) => (
          <GlassMatchupHeader key={index} teamA="loading" teamB="loading" winProbA={null} />
        ))}
      </Stack>
    );
  }

  const standingByTeam = new Map(standings.map((row) => [row.teamId, row]));
  const isFutureWeek = currentWeek !== null && Number(week) > Number(currentWeek);
  const isSelf = (teamId: string) => standingByTeam.get(teamId)?.isSelf ?? false;
  // Your own matchup first, with your team on the left like the Mine view.
  const ordered = pairings
    .map((pairing) =>
      isSelf(pairing.teamBId)
        ? {
            ...pairing,
            teamAId: pairing.teamBId,
            teamBId: pairing.teamAId,
            bonus: [pairing.bonus[1], pairing.bonus[0]] as [number, number],
          }
        : pairing,
    )
    .sort((a, b) => Number(isSelf(b.teamAId)) - Number(isSelf(a.teamAId)));
  const side = (teamId: string, bonus: number) => {
    const standing = standingByTeam.get(teamId);
    return {
      name: standing?.name ?? "Team",
      rows: lineups.get(teamId) ?? [],
      standing,
      logoUrl: standing?.logoUrl,
      bonus,
    };
  };

  return (
    <Stack gap="sm">
      {ordered.map(({ teamAId, teamBId, label, bonus }) => {
        const teamA = side(teamAId, bonus[0]);
        const teamB = side(teamBId, bonus[1]);
        return (
          <MatchupScoreCard
            key={`${teamAId}:${teamBId}`}
            leagueId={leagueId}
            search={{
              ...(isSelf(teamAId) ? {} : { team: teamAId }),
              ...(week !== currentWeek ? { week: Number(week) } : {}),
            }}
            title={label ? `${leagueName} · ${label}` : leagueName}
            ariaLabel={`${teamA.name} vs. ${teamB.name}`}
            week={week}
            teamA={teamA}
            teamB={teamB}
            gamesByTeam={gamesByTeam}
            now={now}
            weekComplete={weekComplete}
            weekRankByFpid={weekRankByFpid}
            headToHead
            showOptimal={isFutureWeek}
          />
        );
      })}
    </Stack>
  );
}
