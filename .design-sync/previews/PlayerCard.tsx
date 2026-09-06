import { Text } from "@mantine/core";
import { PlayerCard, type PlayerCardRow } from "@infiniroot/shared";

const baseRow: PlayerCardRow = {
  name: "Justin Jefferson",
  team: "MIN",
  position: "WR",
  rosRank: 3,
  positionRank: 2,
  rosPpg: 19.4,
  actualPpg: 17.8,
  rosteredByTeamName: "The Gridiron Gurus",
};

export function Default() {
  return <PlayerCard row={baseRow} isRookie={false} />;
}

export function Rookie() {
  return (
    <PlayerCard
      row={{
        ...baseRow,
        name: "Marvin Harrison Jr.",
        team: "ARI",
        rosRank: 12,
        positionRank: 8,
        rosPpg: 14.2,
        actualPpg: 12.9,
      }}
      isRookie
    />
  );
}

export function Injured() {
  return (
    <PlayerCard
      row={{
        ...baseRow,
        name: "Christian McCaffrey",
        team: "SF",
        position: "RB",
        rosRank: 1,
        positionRank: 1,
        injury: { status: "Out", statusShort: "O" },
      }}
      isRookie={false}
    />
  );
}

export function FreeAgent() {
  return (
    <PlayerCard
      row={{ ...baseRow, name: "Tank Dell", rosteredByTeamName: null }}
      isRookie={false}
    />
  );
}

export function WithDepthChartSlot() {
  return (
    <PlayerCard
      row={baseRow}
      isRookie={false}
      leftBadge={{ label: "WR2", color: "grape" }}
      showRosteredBy={false}
    />
  );
}

export function SelectableSelected() {
  return (
    <PlayerCard
      row={baseRow}
      isRookie={false}
      selectable={{ selected: true, onToggle: () => {} }}
      footer={
        <Text size="xs" c="dimmed">
          Suggested trade target - fills your WR2 slot.
        </Text>
      }
    />
  );
}
