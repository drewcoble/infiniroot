import { Badge, Box, Card, Group, Text } from "@mantine/core";
import { positionColorOrDefault } from "@shared/positionColors";
import { PlayerCard } from "./PlayerCard";
import type { RosVorRow, TeamRosterRow } from "../types/season";

interface TradeRosterMatchupProps {
  teamARows: TeamRosterRow[];
  // undefined covers both "no opponent picked yet" and "their roster is
  // still loading" - either way every row on the right falls back to a
  // blank placeholder card (see PlaceholderCard's `empty`) rather than the
  // caller needing to distinguish the two.
  teamBRows: TeamRosterRow[] | undefined;
  vorByFpid: Map<number, RosVorRow>;
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

// Excludes IR/TAXI (not tradeable pieces, same eligibility buildTradePool
// uses) but keeps unfilled slots (unlike a plain roster list would) - an
// empty bench spot on one side still needs a row here so the two teams'
// slots stay lined up alongside each other index-for-index.
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

// Matches the real PlayerCard next to it by stretching to the row's full
// height (see the Group's align="stretch" below) rather than guessing a
// pixel value - `empty` (no dash, nothing) stands in for a whole team that
// isn't known yet; the dash marks a genuinely-unfilled slot on a team whose
// roster IS known. The minHeight is only a floor for the rare row where
// BOTH sides are placeholders (both teams empty in the same slot), so it
// doesn't collapse to just its own padding.
function PlaceholderCard({ empty }: { empty?: boolean }) {
  return (
    <Card
      withBorder
      padding="xs"
      radius="md"
      style={{ flex: 1, minWidth: 0, minHeight: 44 }}
    >
      {!empty && (
        <Text size="sm" c="dimmed">
          —
        </Text>
      )}
    </Card>
  );
}

interface PlayerCellProps {
  row: TeamRosterRow | undefined;
  vorByFpid: Map<number, RosVorRow>;
  selected: Set<number>;
  onToggle: (fpid: number) => void;
}

function PlayerCell({ row, vorByFpid, selected, onToggle }: PlayerCellProps) {
  if (row === undefined || row.fpid === undefined) {
    return <PlaceholderCard empty={row === undefined} />;
  }
  const fpid = row.fpid;
  const vorRow = vorByFpid.get(fpid);
  // display: "grid" (rather than flex) so the single PlayerCard child
  // stretches to fill both axes of this cell by default - a flex container
  // would only auto-stretch the cross axis (height), leaving the card's
  // width up to its own content.
  return (
    <Box style={{ flex: 1, minWidth: 0, display: "grid" }}>
      <PlayerCard
        row={vorRow ?? toFallbackRow(row, fpid)}
        isRookie={row.isRookie ?? false}
        showRosteredBy={false}
        showLeftLabel={false}
        selectable={{ selected: selected.has(fpid), onToggle: () => onToggle(fpid) }}
        rightStats={null}
        footer={
          <Group gap={12} wrap="nowrap">
            <Text size="xs" c="dimmed">
              {(vorRow?.actualVor ?? 0).toFixed(1)} VOR
            </Text>
            <Text size="xs" c="dimmed">
              {(vorRow?.rosVor ?? 0).toFixed(1)} ROS VOR
            </Text>
          </Group>
        }
      />
    </Box>
  );
}

// Both teams' rosters lined up by roster slot, with the slot badge between
// the two teams' cards instead of on each card - a league's slot structure
// (QB, RB, ..., BENCH) is shared by every team in it, so team A's and team
// B's Nth alignable row are always the same slot; zipping by index rather
// than re-deriving a canonical slot list. Team A always renders (your own
// roster loads as soon as the page does); team B renders as blank
// placeholder cards until an opponent's actually picked and loaded, so the
// two-column shape never jumps around as that happens.
export function TradeRosterMatchup({
  teamARows,
  teamBRows,
  vorByFpid,
  selectedA,
  selectedB,
  onToggleA,
  onToggleB,
}: TradeRosterMatchupProps) {
  const aRows = alignableRows(teamARows);
  const bRows = teamBRows ? alignableRows(teamBRows) : undefined;
  const rowCount = Math.max(aRows.length, bRows?.length ?? 0);

  return (
    <>
      {Array.from({ length: rowCount }, (_, index) => {
        const aRow = aRows[index];
        const bRow = bRows?.[index];
        const slot = aRow?.slot ?? bRow?.slot;
        return (
          <Group key={index} wrap="nowrap" gap="xs" align="stretch">
            <PlayerCell row={aRow} vorByFpid={vorByFpid} selected={selectedA} onToggle={onToggleA} />
            <Badge
              size="sm"
              variant="light"
              color={positionColorOrDefault(slot ?? "")}
              style={{ flexShrink: 0, minWidth: 50, alignSelf: "center" }}
            >
              {slotLabel(slot)}
            </Badge>
            {bRows ? (
              <PlayerCell row={bRow} vorByFpid={vorByFpid} selected={selectedB} onToggle={onToggleB} />
            ) : (
              <PlaceholderCard empty />
            )}
          </Group>
        );
      })}
    </>
  );
}
