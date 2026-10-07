import { Box, Group } from "@mantine/core";
import type { SlotLabel, TeamRosterRow } from "../types/season";
import { alignRosterRows } from "../lib/rosterAlignment";
import { Fragment } from "react";
import { ROSTER_SECTION_LABEL, rosterSection, type GlassMatchupCardData } from "./cards/cardShared";
import {
  EmptyGlassCard,
  GlassMatchupCard,
  GlassSectionDivider,
  GlassSkeletonCard,
  GlassSlotChip,
} from "./cards/GlassMatchupCard";

function slotLabel(slot: SlotLabel | undefined): string {
  if (slot === undefined) return "";
  if (slot === "BENCH") return "BN";
  if (slot === "TAXI") return "Taxi";
  if (slot === "SUPERFLEX") return "SFLEX";
  return slot;
}

interface MatchupRosterMatchupProps {
  teamARows: TeamRosterRow[];
  // undefined = no opponent rows to show: either still on the way
  // (teamBLoading - skeleton cards) or there's no opponent (blank wells).
  teamBRows: TeamRosterRow[] | undefined;
  teamBLoading: boolean;
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

function SkeletonCell() {
  return (
    <Box style={{ flex: 1, minWidth: 0, display: "grid" }}>
      <GlassSkeletonCard />
    </Box>
  );
}

// Rows of skeleton cards while your own roster loads (first load, or after
// switching weeks) - a fixed count, since the roster's real length isn't
// known yet.
const SKELETON_ROWS = 9;

export function MatchupRosterSkeleton() {
  return (
    <>
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <Group key={index} wrap="nowrap" gap="xs" align="stretch">
          <SkeletonCell />
          <GlassSlotChip label="" />
          <SkeletonCell />
        </Group>
      ))}
    </>
  );
}

// Both teams' rosters lined up by roster slot for this week's matchup, slot
// chip between the two columns - the glass Matchup cards (see
// components/cards/), long-press for each player's detail card.
export function MatchupRosterMatchup(props: MatchupRosterMatchupProps) {
  return (
    <>
      {alignRosterRows(props.teamARows, props.teamBRows).map(
        ({ a: aRow, b: bRow }, index, rows) => {
          const section = rosterSection(aRow?.slot ?? bRow?.slot);
          const previous = index > 0 ? rows[index - 1] : undefined;
          const startsSection =
            previous !== undefined &&
            rosterSection(previous.a?.slot ?? previous.b?.slot) !== section;
          return (
            <Fragment key={index}>
              {startsSection && <GlassSectionDivider label={ROSTER_SECTION_LABEL[section]} />}
              <Group wrap="nowrap" gap="xs" align="stretch">
                <Cell row={aRow} props={props} />
                <GlassSlotChip label={slotLabel(aRow?.slot ?? bRow?.slot)} />
                {props.teamBRows === undefined && props.teamBLoading ? (
                  <SkeletonCell />
                ) : (
                  <Cell row={props.teamBRows ? bRow : undefined} props={props} />
                )}
              </Group>
            </Fragment>
          );
        },
      )}
    </>
  );
}
