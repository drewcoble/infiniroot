import type { ReactNode } from "react";
import { Badge, Box, Card, Group, Stack, Text } from "@mantine/core";
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

// Wrapper every row cell (a real PlayerCard or a PlaceholderCard) renders
// into, identically - flex: 1/minWidth: 0 for an even width split of the
// row, display: "grid" so the single child stretches to fill both axes
// (unlike flex, grid stretches width too, not just height). Sharing this
// one wrapper for every case, rather than each case styling its own root
// element, is what keeps a placeholder and the real card that later
// replaces it pixel-identical in width - a per-case style previously let
// them drift a hair apart, which read as the layout "jumping" the moment a
// team was picked.
function Cell({ children }: { children: ReactNode }) {
  return <Box style={{ flex: 1, minWidth: 0, display: "grid" }}>{children}</Box>;
}

// `empty` (no dash, nothing) stands in for a whole team that isn't known
// yet; the dash marks a genuinely-unfilled slot on a team whose roster IS
// known. Height comes from Cell's grid stretch (matching whichever card in
// the row is tallest) - minHeight here is only a floor for the rare row
// where both sides are placeholders, so it doesn't collapse to just its own
// padding.
function PlaceholderCard({ empty }: { empty?: boolean }) {
  return (
    <Card withBorder padding="xs" radius="md" style={{ minHeight: 44 }}>
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
    return (
      <Cell>
        <PlaceholderCard empty={row === undefined} />
      </Cell>
    );
  }
  const fpid = row.fpid;
  const vorRow = vorByFpid.get(fpid);
  return (
    <Cell>
      <PlayerCard
        row={vorRow ?? toFallbackRow(row, fpid)}
        isRookie={row.isRookie ?? false}
        showRosteredBy={false}
        showLeftLabel={false}
        selectable={{ selected: selected.has(fpid), onToggle: () => onToggle(fpid) }}
        rightStats={null}
        footer={
          <Stack gap={0}>
            <Text size="xs" c="dimmed">
              {(vorRow?.actualVor ?? 0).toFixed(1)} VOR
            </Text>
            <Text size="xs" c="dimmed">
              {(vorRow?.rosVor ?? 0).toFixed(1)} ROS VOR
            </Text>
          </Stack>
        }
      />
    </Cell>
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
              <Cell>
                <PlaceholderCard empty />
              </Cell>
            )}
          </Group>
        );
      })}
    </>
  );
}
