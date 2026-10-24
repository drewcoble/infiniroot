import { Stack } from "@mantine/core";
import { GlassTeamCard } from "./cards/GlassTeamCard";
import { GlassRosterSkeletonCard } from "./cards/GlassRosterCard";
import type { ProjectedStandingsRow, TeamPositionRanks } from "../types/season";

interface ProjectedStandingsListProps {
  leagueId: string;
  rows: ProjectedStandingsRow[] | undefined;
  // See StandingsList's identical prop.
  positionRanksByTeam: Map<string, TeamPositionRanks> | undefined;
}

// Projected final regular-season standings (see convex/infinileague/season/
// projectedStandings.ts) - already sorted and ranked server-side. No
// up/down badge: on the league home those mean change since last week (see
// PowerRankingsList), so today's rank sits in the "Now" line instead.
export function ProjectedStandingsList({
  leagueId,
  rows,
  positionRanksByTeam,
}: ProjectedStandingsListProps) {
  if (rows === undefined) {
    return (
      <Stack gap={8}>
        {Array.from({ length: 8 }, (_, index) => (
          <GlassRosterSkeletonCard key={index} />
        ))}
      </Stack>
    );
  }

  return (
    <Stack gap={8}>
      {rows.map((row) => {
        const record = `${row.wins}-${row.losses}-${row.ties}`;
        const current = `${row.currentWins}-${row.currentLosses}-${row.currentTies}`;
        const currentRank = row.rank + row.rankChange;
        const now = `Now ${current}, #${currentRank}`;
        return (
          <GlassTeamCard
            key={row.teamId}
            data={{
              leagueId,
              teamId: row.teamId,
              name: row.name,
              rank: row.rank,
              isSelf: row.isSelf,
              primary: record,
              secondaryLeft: <span className="num">{now}</span>,
              summary: now,
              stats: [
                {
                  label: "Projected",
                  items: [
                    { label: "Record", value: record },
                    { label: "Points for", value: row.pointsFor.toFixed(0) },
                  ],
                },
                {
                  label: "Today",
                  items: [
                    { label: "Record", value: current },
                    { label: "Rank", value: `#${currentRank}` },
                  ],
                },
              ],
            }}
            positionRanks={positionRanksByTeam?.get(row.teamId)}
            totalTeams={rows.length}
          />
        );
      })}
    </Stack>
  );
}
