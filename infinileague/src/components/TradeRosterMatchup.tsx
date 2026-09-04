import { Badge, Box, Card, Group, Text } from "@mantine/core";
import { positionColorOrDefault } from "@shared/positionColors";
import { PlayerCard } from "./PlayerCard";
import type { RosVorRow, TeamRosterRow } from "../types/season";
import type { TradeValueMetric } from "../lib/tradeAnalyzer";

interface TradeRosterMatchupProps {
  teamARows: TeamRosterRow[];
  teamBRows: TeamRosterRow[];
  vorByFpid: Map<number, RosVorRow>;
  metric: TradeValueMetric;
  selectedA: Set<number>;
  selectedB: Set<number>;
  onToggleA: (fpid: number) => void;
  onToggleB: (fpid: number) => void;
}

function slotLabel(slot: TeamRosterRow["slot"]): string {
  if (slot === undefined) return "";
  if (slot === "BENCH") return "BN";
  if (slot === "SUPERFLEX") return "SFLEX";
  return slot;
}

// Same "not a tradeable piece" exclusion TradeRosterPanel's solo list uses,
// but keeps unfilled slots (unlike that list) - an empty bench spot on one
// side still needs a row here so the two teams' slots stay lined up
// alongside each other index-for-index.
function alignableRows(rows: TeamRosterRow[]): TeamRosterRow[] {
  return rows.filter((row) => row.slot !== undefined && row.slot !== "IR" && row.slot !== "TAXI");
}

function toFallbackRow(row: TeamRosterRow, fpid: number): RosVorRow {
  return {
    fpid,
    name: row.name ?? "",
    team: row.team ?? null,
    position: row.position ?? "QB",
    rosVor: 0,
    rosRank: 0,
    actualVor: 0,
    actualRank: 0,
    positionRank: 0,
    rosPpg: 0,
    actualPpg: 0,
    rosteredByTeamName: null,
    ...(row.injury ? { injury: row.injury } : {}),
  };
}

interface PlayerCellProps {
  row: TeamRosterRow | undefined;
  vorByFpid: Map<number, RosVorRow>;
  metric: TradeValueMetric;
  metricLabel: string;
  selected: Set<number>;
  onToggle: (fpid: number) => void;
}

function PlayerCell({ row, vorByFpid, metric, metricLabel, selected, onToggle }: PlayerCellProps) {
  if (row === undefined) {
    return <Box style={{ flex: 1, minWidth: 0 }} />;
  }
  if (row.fpid === undefined) {
    return (
      <Card withBorder padding="xs" radius="md" style={{ flex: 1, minWidth: 0 }}>
        <Text size="sm" c="dimmed">
          —
        </Text>
      </Card>
    );
  }
  const fpid = row.fpid;
  const vorRow = vorByFpid.get(fpid);
  const value = vorRow?.[metric] ?? 0;
  return (
    <Box style={{ flex: 1, minWidth: 0 }}>
      <PlayerCard
        row={vorRow ?? toFallbackRow(row, fpid)}
        isRookie={row.isRookie ?? false}
        showRosteredBy={false}
        checkbox={{ checked: selected.has(fpid), onChange: () => onToggle(fpid) }}
        rightStats={
          <Text size="xs" c="dimmed">
            {value.toFixed(1)} {metricLabel}
          </Text>
        }
      />
    </Box>
  );
}

// Both teams' rosters lined up by roster slot once an opponent's picked -
// replaces trade.tsx's earlier side-by-side TradeRosterPanel pair, putting
// the slot label between the two teams' cards instead of on each card (a
// league's slot structure - QB, RB, ..., BENCH - is shared by every team in
// it, so team A's and team B's Nth alignable row are always the same slot;
// zipping by index rather than re-deriving a canonical slot list).
export function TradeRosterMatchup({
  teamARows,
  teamBRows,
  vorByFpid,
  metric,
  selectedA,
  selectedB,
  onToggleA,
  onToggleB,
}: TradeRosterMatchupProps) {
  const aRows = alignableRows(teamARows);
  const bRows = alignableRows(teamBRows);
  const rowCount = Math.max(aRows.length, bRows.length);
  const metricLabel = metric === "rosVor" ? "ROS VOR" : "VOR";

  return (
    <>
      {Array.from({ length: rowCount }, (_, index) => {
        const aRow = aRows[index];
        const bRow = bRows[index];
        const slot = aRow?.slot ?? bRow?.slot;
        return (
          <Group key={index} wrap="nowrap" gap="xs" align="center">
            <PlayerCell
              row={aRow}
              vorByFpid={vorByFpid}
              metric={metric}
              metricLabel={metricLabel}
              selected={selectedA}
              onToggle={onToggleA}
            />
            <Badge
              size="sm"
              variant="light"
              color={positionColorOrDefault(slot ?? "")}
              style={{ flexShrink: 0, minWidth: 50 }}
            >
              {slotLabel(slot)}
            </Badge>
            <PlayerCell
              row={bRow}
              vorByFpid={vorByFpid}
              metric={metric}
              metricLabel={metricLabel}
              selected={selectedB}
              onToggle={onToggleB}
            />
          </Group>
        );
      })}
    </>
  );
}
