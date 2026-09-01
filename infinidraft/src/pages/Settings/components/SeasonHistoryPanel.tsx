import { Badge, Group, Stack, Text } from "@mantine/core";
import type { Id } from "@infinidata/dataModel";
import { SeasonSummary } from "../SeasonSummary";

interface SeasonLineageRow {
  _id: Id<"seasons">;
  year: string;
}

interface SeasonHistoryPanelProps {
  seasonLineage: SeasonLineageRow[] | undefined;
  currentSettingsId: Id<"seasons">;
  historySeasonId: Id<"seasons"> | null;
  onSelectHistorySeason: (id: Id<"seasons"> | null) => void;
}

export function SeasonHistoryPanel({
  seasonLineage,
  currentSettingsId,
  historySeasonId,
  onSelectHistorySeason,
}: SeasonHistoryPanelProps) {
  return (
    <Stack gap={6}>
      <Text size="md" fw={500}>
        Seasons
      </Text>
      <Group gap="xs">
        {(seasonLineage ?? []).map((row) => (
          <Badge
            key={row._id}
            size="lg"
            variant={row._id === currentSettingsId ? "filled" : "light"}
            style={{ cursor: "pointer" }}
            onClick={() =>
              onSelectHistorySeason(
                row._id === currentSettingsId
                  ? null
                  : historySeasonId === row._id
                    ? null
                    : row._id,
              )
            }
          >
            {row.year}
            {row._id === currentSettingsId ? " (current)" : ""}
          </Badge>
        ))}
      </Group>
      {historySeasonId && historySeasonId !== currentSettingsId && (
        <SeasonSummary seasonId={historySeasonId} />
      )}
    </Stack>
  );
}
