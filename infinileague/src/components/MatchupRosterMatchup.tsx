import { Box, Group } from "@mantine/core";
import type { SlotLabel, TeamRosterRow } from "../types/season";
import { alignRosterRows } from "../lib/rosterAlignment";
import type { GlassMatchupCardData } from "./cards/cardShared";
import { EmptyGlassCard, GlassMatchupCard, GlassSlotChip } from "./cards/GlassMatchupCard";

function slotLabel(slot: SlotLabel | undefined): string {
  if (slot === undefined) return "";
  if (slot === "BENCH") return "BN";
  if (slot === "TAXI") return "Taxi";
  if (slot === "SUPERFLEX") return "SFLEX";
  return slot;
}

interface MatchupRosterMatchupProps {
  teamARows: TeamRosterRow[];
  // undefined covers both "opponent not known yet" and "their roster is
  // still loading" - either way every card on the right is a blank well.
  teamBRows: TeamRosterRow[] | undefined;
  toCardData: (row: TeamRosterRow) => GlassMatchupCardData;
  shortName: (fullName: string) => string;
  // Shared meter scale for every card on the page (see meterScale.ts).
  scaleMax: number;
}

// Same wrapper both TradeRosterMatchup and this component render every row
// cell into - flex: 1/minWidth: 0 for an even width split, grid so the card
// stretches to match whichever side of the row is taller.
function Cell({
  row,
  props,
}: {
  row: TeamRosterRow | undefined;
  props: MatchupRosterMatchupProps;
}) {
  return (
    <Box style={{ flex: 1, minWidth: 0, display: "grid" }}>
      {row?.fpid !== undefined ? (
        <GlassMatchupCard
          data={props.toCardData(row)}
          displayName={props.shortName(row.name ?? "")}
          slot={slotLabel(row.slot)}
          scaleMax={props.scaleMax}
        />
      ) : (
        <EmptyGlassCard label={row ? "Empty" : ""} />
      )}
    </Box>
  );
}

// Both teams' rosters lined up by roster slot for this week's matchup, slot
// chip between the two columns - the glass Matchup cards (see
// components/cards/), long-press for each player's detail card.
export function MatchupRosterMatchup(props: MatchupRosterMatchupProps) {
  return (
    <>
      {alignRosterRows(props.teamARows, props.teamBRows).map(({ a: aRow, b: bRow }, index) => (
        <Group key={index} wrap="nowrap" gap="xs" align="stretch">
          <Cell row={aRow} props={props} />
          <GlassSlotChip label={slotLabel(aRow?.slot ?? bRow?.slot)} />
          <Cell row={props.teamBRows ? bRow : undefined} props={props} />
        </Group>
      ))}
    </>
  );
}
