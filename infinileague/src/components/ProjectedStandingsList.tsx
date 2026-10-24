import { Stack } from "@mantine/core";
import { GlassTeamCard } from "./cards/GlassTeamCard";
import { GlassRosterSkeletonCard } from "./cards/GlassRosterCard";
import { RankChangeBadge } from "./PowerRankingsList";
import type { ProjectedStandingsRow, TeamPositionRanks } from "../types/season";

interface ProjectedStandingsListProps {
  leagueId: string;
  rows: ProjectedStandingsRow[] | undefined;
  // See StandingsList's identical prop.
  positionRanksByTeam: Map<string, TeamPositionRanks> | undefined;
}

// Projected final regular-season standings (see convex/infinileague/season/
// projectedStandings.ts) - already sorted and ranked server-side. The badge
// is each team's move from where it stands today.
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
        return (
          <GlassTeamCard
            key={row.teamId}
            data={{
              leagueId,
              teamId: row.teamId,
              name: row.name,
              rank: row.rank,
              isSelf: row.isSelf,
              nameBadges: <RankChangeBadge rankChange={row.rankChange} since="from today" />,
              primary: record,
              secondaryLeft: <span className="num">Now {current}</span>,
              summary: `Now ${current}`,
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
                    { label: "Rank", value: String(row.rank + row.rankChange) },
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
