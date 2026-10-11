import { Box, Group, Text } from "@mantine/core";
import type { TeamRosterRow } from "../types/season";
import { alignRosterRows } from "../lib/rosterAlignment";
import { slotLabel } from "../lib/matchupCardData";
import { isStarter } from "../lib/matchupSummary";
import { Fragment } from "react";
import {
  ROSTER_SECTION_LABEL,
  rosterSection,
  type GlassMatchupCardData,
} from "./cards/cardShared";
import {
  EmptyGlassCard,
  GlassMatchupCard,
  GlassSectionDivider,
  GlassSkeletonCard,
  GlassSlotChip,
} from "./cards/GlassMatchupCard";

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
  // "Live only": just the starters whose games are underway - every other
  // row is dropped, and a row with a live starter on only one side leaves
  // the other side a blank well. See the Matchup page's toggle.
  liveOnly?: boolean;
}

// Same wrapper both TradeRosterMatchup and this component render every row
// cell into - flex: 1/minWidth: 0 for an even width split, grid so the card
// stretches to match whichever side of the row is taller.
function Cell({
  row,
  props,
  hidden,
}: {
  row: TeamRosterRow | undefined;
  props: MatchupRosterMatchupProps;
  // Live only's non-live side of a row - shown as a blank well.
  hidden?: boolean;
}) {
  return (
    <Box style={{ flex: 1, minWidth: 0, display: "grid" }}>
      {hidden ? (
        <EmptyGlassCard label="" />
      ) : row?.fpid !== undefined ? (
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
  const isLiveStarter = (row: TeamRosterRow | undefined) =>
    row?.fpid !== undefined &&
    isStarter(row) &&
    props.toCardData(row).gameState === "live";
  const hiddenFor = (row: TeamRosterRow | undefined) =>
    props.liveOnly === true && !isLiveStarter(row);
  const rows = alignRosterRows(props.teamARows, props.teamBRows).filter(
    (row) => !props.liveOnly || isLiveStarter(row.a) || isLiveStarter(row.b),
  );

  if (props.liveOnly && rows.length === 0) {
    return (
      <Text size="sm" c="dimmed" ta="center" py="md">
        No starters in this matchup are in a live game right now.
      </Text>
    );
  }

  return (
    <>
      {rows.map(({ a: aRow, b: bRow }, index) => {
        const section = rosterSection(aRow?.slot ?? bRow?.slot);
        const previous = index > 0 ? rows[index - 1] : undefined;
        const startsSection =
          previous !== undefined && rosterSection(previous.a?.slot ?? previous.b?.slot) !== section;
        return (
          <Fragment key={`${aRow?.fpid ?? aRow?.slot}-${bRow?.fpid ?? bRow?.slot}-${index}`}>
            {startsSection && <GlassSectionDivider label={ROSTER_SECTION_LABEL[section]} />}
            <Group wrap="nowrap" gap="xs" align="stretch">
              <Cell row={aRow} props={props} hidden={hiddenFor(aRow)} />
              <GlassSlotChip label={slotLabel(aRow?.slot ?? bRow?.slot)} />
              {props.teamBRows === undefined && props.teamBLoading ? (
                <SkeletonCell />
              ) : (
                <Cell
                  row={props.teamBRows ? bRow : undefined}
                  props={props}
                  hidden={hiddenFor(bRow)}
                />
              )}
            </Group>
          </Fragment>
        );
      })}
    </>
  );
}
