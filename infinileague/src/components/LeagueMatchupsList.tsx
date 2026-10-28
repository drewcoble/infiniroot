import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { Alert, Stack, Text } from "@mantine/core";
import { api } from "@infinidata/api";
import { getErrorMessage } from "@shared/errors";
import { GlassMatchupHeader } from "./cards/GlassMatchupHeader";
import { MatchupScoreCard } from "./MatchupScoreCard";
import type { WeekGame } from "../lib/liveGames";
import type { LeagueWeekMatchups, StandingsRow } from "../types/season";

// Every matchup in the league for one week - the Matchup tab's League view.
// One score card per pairing (the same MatchupScoreCard as the cross-league
// Matchups page), your own first; tapping one opens that matchup in the
// Matchup tab. refreshMs re-fetches every lineup while games are live, same
// as useTeamRoster - a failed refresh keeps the last cards on screen.
export function LeagueMatchupsList({
  leagueId,
  leagueName,
  week,
  currentWeek,
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
  standings: StandingsRow[];
  gamesByTeam: Map<string, WeekGame> | undefined;
  now: number;
  weekComplete: boolean;
  weekRankByFpid: Map<number, number>;
  refreshMs: number | null;
}) {
  const getLeagueWeekMatchups = useAction(
    api.infinileague.season.matchup.getLeagueWeekMatchups,
  );
  // Tagged with the week it was fetched for, same as useTeamRoster - a week
  // change reads as loading straight away.
  const key = `${leagueId}:${week}`;
  const [result, setResult] = useState<{
    key: string;
    data?: LeagueWeekMatchups;
    error?: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = (isRefresh: boolean) =>
      getLeagueWeekMatchups({ seasonId: leagueId as Id<"seasons">, week })
        .then((data) => {
          if (!cancelled) setResult({ key, data });
        })
        .catch((err) => {
          if (cancelled || isRefresh) return;
          setResult({ key, error: getErrorMessage(err, "Failed to load this week's matchups.") });
        });
    void load(false);
    const id = refreshMs !== null ? setInterval(() => void load(true), refreshMs) : null;
    return () => {
      cancelled = true;
      if (id !== null) clearInterval(id);
    };
  }, [leagueId, week, key, refreshMs, getLeagueWeekMatchups]);

  const current = result !== null && result.key === key ? result : null;
  if (current?.error) return <Alert color="red">{current.error}</Alert>;
  if (!current?.data) {
    return (
      <Stack gap="sm">
        {Array.from({ length: 5 }, (_, index) => (
          <GlassMatchupHeader key={index} teamA="loading" teamB="loading" winProbA={null} />
        ))}
      </Stack>
    );
  }

  const { data } = current;
  if (data.matchups.length === 0) {
    return (
      <Text c="dimmed" ta="center" py="xl">
        {data.isPlayoffWeek ? "No playoff matchups set this week." : "No matchups this week."}
      </Text>
    );
  }

  const standingByTeam = new Map(standings.map((row) => [row.teamId, row]));
  const lineupByTeam = new Map(data.lineupsByTeam.map((entry) => [entry.teamId, entry.rows]));
  const isFutureWeek = currentWeek !== null && Number(week) > Number(currentWeek);
  const isSelf = (teamId: string) => standingByTeam.get(teamId)?.isSelf ?? false;
  // Your own matchup first, with your team on the left like the Matchup tab.
  const matchups = data.matchups
    .map(({ teamAId, teamBId, roundName }) =>
      isSelf(teamBId)
        ? { teamAId: teamBId, teamBId: teamAId, roundName }
        : { teamAId, teamBId, roundName },
    )
    .sort((a, b) => Number(isSelf(b.teamAId)) - Number(isSelf(a.teamAId)));
  const side = (teamId: string) => {
    const standing = standingByTeam.get(teamId);
    return {
      name: standing?.name ?? "Team",
      rows: lineupByTeam.get(teamId) ?? [],
      standing,
      logoUrl: standing?.logoUrl,
    };
  };

  return (
    <Stack gap="sm">
      {matchups.map(({ teamAId, teamBId, roundName }) => {
        const teamA = side(teamAId);
        const teamB = side(teamBId);
        return (
          <MatchupScoreCard
            key={`${teamAId}:${teamBId}`}
            leagueId={leagueId}
            search={{
              ...(isSelf(teamAId) ? {} : { team: teamAId }),
              ...(week !== currentWeek ? { week: Number(week) } : {}),
            }}
            title={roundName ? `${leagueName} · ${roundName}` : leagueName}
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
