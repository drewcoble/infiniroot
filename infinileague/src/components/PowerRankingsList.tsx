import { Group, Stack, Text } from "@mantine/core";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { pillStyle } from "./cards/cardShared";
import { GlassTeamCard } from "./cards/GlassTeamCard";
import { GlassRosterSkeletonCard } from "./cards/GlassRosterCard";
import classes from "./cards/GlassMatchupCard.module.css";
import type { PowerRankingRow, TeamPositionRanks } from "../types/season";

interface PowerRankingsListProps {
  leagueId: string;
  rows: PowerRankingRow[] | undefined;
  // See StandingsList's identical prop.
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
// Week-over-week move as a glass badge on the team card - green up, red
// down, gray dash for unchanged; nothing without a prior week to compare.
function RankChangeBadge({ rankChange }: { rankChange: number | undefined }) {
  if (rankChange === undefined) return null;
  const color = rankChange > 0 ? "green" : rankChange < 0 ? "red" : "gray";
  const Icon = rankChange > 0 ? ArrowUp : rankChange < 0 ? ArrowDown : Minus;
  return (
    <span
      className={classes.pill}
      style={{ ...pillStyle(color), fontFamily: "var(--font-numeric)" }}
      aria-label={
        rankChange === 0
          ? "No change since last week"
          : `${rankChange > 0 ? "Up" : "Down"} ${Math.abs(rankChange)} since last week`
      }
    >
      <Icon size={12} strokeWidth={3} />
      {rankChange !== 0 && Math.abs(rankChange)}
    </span>
  );
}

function rankChangeText(rankChange: number | undefined): string {
  if (rankChange === undefined) return "—";
  if (rankChange === 0) return "No change";
  return `${rankChange > 0 ? "Up" : "Down"} ${Math.abs(rankChange)}`;
}

export function PowerRankingsList({ leagueId, rows, positionRanksByTeam }: PowerRankingsListProps) {
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
      {rows.map((row, index) => (
        <GlassTeamCard
          key={row.teamId}
          data={{
            leagueId,
            teamId: row.teamId,
            name: row.name,
            rank: index + 1,
            isSelf: row.isSelf,
            nameBadges: <RankChangeBadge rankChange={row.rankChange} />,
            primary: row.totalProjectedPoints.toFixed(1),
            secondaryRight: "Proj pts",
            stats: [
              { label: "Proj pts", value: row.totalProjectedPoints.toFixed(1) },
              { label: "Since last wk", value: rankChangeText(row.rankChange) },
            ],
          }}
          positionRanks={positionRanksByTeam?.get(row.teamId)}
          totalTeams={rows.length}
        />
      ))}
    </Stack>
  );
}
