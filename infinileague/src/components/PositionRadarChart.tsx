import { Paper, Text } from "@mantine/core";
import { RadarChart } from "@mantine/charts";
import { gradeColor } from "../lib/gradeColor";
import type { StarterCategory } from "../types/season";

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function rankDescriptor(rank: number, totalTeams: number): string {
  if (rank === 1) return "Best";
  if (rank === totalTeams) return "Worst";
  return `${ordinal(rank)} best`;
}

interface PositionRadarChartProps {
  positionalRanks: { category: StarterCategory; rank: number }[];
  totalTeams: number;
  gradeScore: number;
}

// Per-team positional strength, starters only (no bench) - each axis is a
// league-wide 1-indexed rank (1 = best) for that category's starters, so
// the polygon's shape shows where a team is strong/weak relative to the
// rest of the league rather than an absolute point total. Ported from
// infinidraft's DraftReportCard.tsx's identical PositionalRadarChart (same
// @mantine/charts RadarChart, same reversed/domain trick, same tooltip
// shape) - see that file's own comment for the full reasoning.
export function PositionRadarChart({
  positionalRanks,
  totalTeams,
  gradeScore,
}: PositionRadarChartProps) {
  // Nothing to rank against with 0-1 other teams.
  if (totalTeams <= 1 || positionalRanks.length === 0) return null;

  const data = positionalRanks.map(({ category, rank }) => ({ category, rank }));

  return (
    <RadarChart
      h={200}
      data={data}
      dataKey="category"
      series={[{ name: "rank", color: gradeColor(gradeScore) }]}
      withPolarRadiusAxis
      polarRadiusAxisProps={{
        domain: [1, totalTeams],
        reversed: true,
        tick: false,
        axisLine: false,
        tickLine: false,
      }}
      withTooltip
      tooltipProps={{
        content: (props) => {
          const entry = props.active ? props.payload?.[0] : undefined;
          if (!entry) return null;
          const point = entry.payload as { category: string; rank: number };
          return (
            <Paper withBorder shadow="sm" p="xs">
              <Text size="sm" fw={700}>
                {point.category}
              </Text>
              <Text size="xs" c="dimmed">
                {rankDescriptor(point.rank, totalTeams)} in the league
              </Text>
            </Paper>
          );
        },
      }}
    />
  );
}
