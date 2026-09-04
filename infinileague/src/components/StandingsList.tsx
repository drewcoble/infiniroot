import { Stack, Text } from "@mantine/core";
import { TeamCard } from "./TeamCard";
import { TeamPositionRanksPanel } from "./TeamPositionRanksPanel";
import type { StandingsRow, TeamPositionRanks } from "../types/season";

interface StandingsListProps {
  leagueId: string;
  rows: StandingsRow[];
  // Click-to-expand a team's card into its position radar chart - shared
  // across StandingsList/PowerRankingsList so a team's expanded state
  // (and the underlying getTeamPositionRanks fetch, which needs every
  // team's roster regardless of which one card is open) persists across
  // switching between the two tabs.
  expandedTeamIds: Set<string>;
  onToggleExpand: (teamId: string) => void;
  positionRanksByTeam: Map<string, TeamPositionRanks> | undefined;
}

// Ranked by win percentage, points scored as tiebreaker - both already
// computed/sorted server-side (see convex/season/standings.ts's
// getStandings), this just renders the rows in the order they arrive.
// Exactly one of faabRemaining/waiverPosition is set per row (chosen by the
// season's waiverType), so the label is derived per-row rather than once.
export function StandingsList({
  leagueId,
  rows,
  expandedTeamIds,
  onToggleExpand,
  positionRanksByTeam,
}: StandingsListProps) {
  return (
    <Stack gap={8}>
      {rows.map((row) => (
        <TeamCard
          key={row.teamId}
          leagueId={leagueId}
          teamId={row.teamId}
          name={row.name}
          isSelf={row.isSelf}
          leftLabel={row.rank}
          stats={
            <>
              <Text size="sm" fw={500}>
                {row.wins}-{row.losses}-{row.ties}
              </Text>
              <Text size="xs" c="dimmed">
                {row.pointsFor.toFixed(1)} PF / {row.pointsAgainst.toFixed(1)} PA
              </Text>
              <Text size="xs" c="dimmed">
                {row.faabRemaining !== undefined
                  ? `$${row.faabRemaining} FAAB`
                  : `Waiver #${row.waiverPosition ?? "—"}`}
              </Text>
            </>
          }
          expanded={expandedTeamIds.has(row.teamId)}
          onToggleExpand={() => onToggleExpand(row.teamId)}
          expandedContent={
            <TeamPositionRanksPanel
              positionRanks={positionRanksByTeam?.get(row.teamId)}
              totalTeams={rows.length}
            />
          }
        />
      ))}
    </Stack>
  );
}
