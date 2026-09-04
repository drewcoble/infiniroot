import { Group, Loader, Stack, Text } from "@mantine/core";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { TeamCard } from "./TeamCard";
import { TeamPositionRanksPanel } from "./TeamPositionRanksPanel";
import type { PowerRankingRow, TeamPositionRanks } from "../types/season";

interface PowerRankingsListProps {
  leagueId: string;
  rows: PowerRankingRow[] | undefined;
  // See StandingsList's identical props for why this lives one level up
  // rather than as local state here.
  expandedTeamIds: Set<string>;
  onToggleExpand: (teamId: string) => void;
  positionRanksByTeam: Map<string, TeamPositionRanks> | undefined;
}

// Same up/down convention as LineupSuggestionsCard's start/sit arrows -
// green up, red down - plus a dash for "unchanged" and nothing at all when
// there's no prior week to compare against (rankChange absent). Exported for
// TradePowerRankingsList.tsx, which reuses it for trade-induced rank
// movement instead of this list's week-over-week snapshot movement.
export function RankChangeIndicator({ rankChange }: { rankChange: number | undefined }) {
  if (rankChange === undefined) return null;
  if (rankChange === 0) {
    return <Minus size={14} color="var(--mantine-color-dimmed)" />;
  }
  return (
    <Group gap={2} wrap="nowrap">
      {rankChange > 0 ? (
        <ArrowUp size={14} color="var(--mantine-color-green-6)" />
      ) : (
        <ArrowDown size={14} color="var(--mantine-color-red-6)" />
      )}
      <Text size="xs" c={rankChange > 0 ? "green" : "red"} span>
        {Math.abs(rankChange)}
      </Text>
    </Group>
  );
}

// Rest-of-season strength read: each team's optimal-lineup total from the
// current week through week 18 (see convex/infinileague/season/
// powerRankings.ts), as opposed to StandingsList's backward-looking win/
// loss record. rankChange is this week's rank vs. the last snapshot the
// backend saved (also powerRankings.ts) - absent, not zero, the very first
// time it's computed for a season.
export function PowerRankingsList({
  leagueId,
  rows,
  expandedTeamIds,
  onToggleExpand,
  positionRanksByTeam,
}: PowerRankingsListProps) {
  if (rows === undefined) {
    return <Loader size="sm" />;
  }

  return (
    <Stack gap={8}>
      {rows.map((row, index) => (
        <TeamCard
          key={row.teamId}
          leagueId={leagueId}
          teamId={row.teamId}
          name={row.name}
          isSelf={row.isSelf}
          leftLabel={index + 1}
          nameSuffix={<RankChangeIndicator rankChange={row.rankChange} />}
          stats={
            <Text size="sm" fw={500}>
              {row.totalProjectedPoints.toFixed(1)} pts
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
