import { Stack } from "@mantine/core";
import { GlassTeamCard } from "./cards/GlassTeamCard";
import { GlassRosterSkeletonCard } from "./cards/GlassRosterCard";
import { RankChangeBadge } from "./PowerRankingsList";
import type { ProjectedStandingsRow, TeamPositionRanks } from "../types/season";

// Expected record in whole games ("9-5"), ties only when there are any.
// Losses are what's left of the season after rounded wins, so the record
// always adds up to the full schedule (9.5-4.5 reads 10-4, not 10-5).
function expectedRecord(row: ProjectedStandingsRow): string {
  const games = Math.round(row.wins + row.losses);
  const wins = Math.round(row.wins);
  const record = `${wins}-${games - wins}`;
  return row.ties > 0 ? `${record}-${row.ties}` : record;
}

interface ProjectedStandingsListProps {
  leagueId: string;
  rows: ProjectedStandingsRow[] | undefined;
  // See StandingsList's identical prop.
  positionRanksByTeam: Map<string, TeamPositionRanks> | undefined;
}

// Projected final regular-season standings (see convex/infinileague/season/
// projectedStandings.ts) - already sorted and ranked server-side. The badge
// is the projected finish's move since last week, same as PowerRankingsList;
// today's rank sits in the "Now" line.
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
        const record = expectedRecord(row);
        const current = `${row.currentWins}-${row.currentLosses}-${row.currentTies}`;
        const now = `Now ${current}, #${row.currentRank}`;
        return (
          <GlassTeamCard
            key={row.teamId}
            data={{
              leagueId,
              teamId: row.teamId,
              name: row.name,
              rank: row.rank,
              isSelf: row.isSelf,
              nameBadges: <RankChangeBadge rankChange={row.rankChange} />,
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
                    { label: "Rank", value: `#${row.currentRank}` },
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
