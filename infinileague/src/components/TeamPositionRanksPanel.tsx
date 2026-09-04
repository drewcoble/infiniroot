import { Badge, Group, Loader, Text } from "@mantine/core";
import { PositionRadarChart } from "./PositionRadarChart";
import { gradeColor } from "../lib/gradeColor";
import type { TeamPositionRanks } from "../types/season";

interface TeamPositionRanksPanelProps {
  // undefined while getTeamPositionRanks is still loading - the badge/chart
  // both wait on this rather than the card's own expand state, since the
  // fetch is shared across every team's card (see index.tsx).
  positionRanks: TeamPositionRanks | undefined;
  totalTeams: number;
}

// Expanded-card content shared by StandingsList/PowerRankingsList - a
// numeric 0-100 score (not a letter grade, per the dashboard's own
// convention) colored the same way infinidraft's report card colors its
// letter grades, plus the position radar chart itself.
export function TeamPositionRanksPanel({ positionRanks, totalTeams }: TeamPositionRanksPanelProps) {
  if (positionRanks === undefined) {
    return <Loader size="xs" />;
  }
  return (
    <>
      <Group justify="space-between" mb={4}>
        <Text size="xs" c="dimmed">
          Position strength
        </Text>
        <Badge color={gradeColor(positionRanks.gradeScore)} size="sm">
          {positionRanks.gradeScore}
        </Badge>
      </Group>
      <PositionRadarChart
        positionalRanks={positionRanks.positionalRanks}
        totalTeams={totalTeams}
        gradeScore={positionRanks.gradeScore}
      />
    </>
  );
}
