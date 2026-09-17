import { Badge, Loader, Stack, Text } from "@mantine/core";
import { TeamCard } from "./TeamCard";
import { TeamPositionRanksPanel } from "./TeamPositionRanksPanel";
import type { EliminationWatchRow, TeamPositionRanks } from "../types/season";

interface EliminationWatchListProps {
  leagueId: string;
  rows: EliminationWatchRow[] | undefined;
  // See StandingsList's identical props for why this lives one level up
  // rather than as local state here.
  expandedTeamIds: Set<string>;
  onToggleExpand: (teamId: string) => void;
  positionRanksByTeam: Map<string, TeamPositionRanks> | undefined;
}

// Same red/gold/green three-band convention lib/gradeColor.ts uses (see
// that file's comment on why those, not raw Mantine "yellow") - here keyed
// off eliminationWatch.ts's own cut/bubble/safe status instead of a
// continuous score.
const STATUS_BADGE: Record<
  EliminationWatchRow["status"],
  { label: string; color: string }
> = {
  cut: { label: "Projected Cut", color: "red" },
  bubble: { label: "Bubble", color: "gold" },
  safe: { label: "Safe", color: "green" },
};

// This week's guillotine elimination projection: each team's optimal-lineup
// total for just the current NFL week (see convex/infinileague/season/
// eliminationWatch.ts), ranked best-to-worst same as PowerRankingsList, with
// the bottom slice flagged red (projected cut) / gold (bubble) / green
// (safe) via the status badge instead of a week-over-week rank arrow.
export function EliminationWatchList({
  leagueId,
  rows,
  expandedTeamIds,
  onToggleExpand,
  positionRanksByTeam,
}: EliminationWatchListProps) {
  if (rows === undefined) {
    return <Loader size="sm" />;
  }

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
          nameSuffix={
            <Badge size="sm" variant="light" color={STATUS_BADGE[row.status].color}>
              {STATUS_BADGE[row.status].label}
            </Badge>
          }
          stats={
            <Text size="sm" fw={500}>
              {row.weekPoints.toFixed(1)} pts
            </Text>
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
