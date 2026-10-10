import { Box, Group, Text } from "@mantine/core";
import type { TeamRosterRow } from "../types/season";
import { alignRosterRows } from "../lib/rosterAlignment";
import { slotLabel } from "../lib/matchupCardData";
import { Fragment } from "react";
import {
  FINAL_CARD_OPACITY,
  MUTED_CARD_OPACITY,
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
  // "Live only": rows with no live player on either side are dropped; a
  // row with a live player on one side still shows both, the non-live one
  // dimmed so the live side leads. See the Matchup page's toggle.
  liveOnly?: boolean;
}

// Same wrapper both TradeRosterMatchup and this component render every row
// cell into - flex: 1/minWidth: 0 for an even width split, grid so the card
// stretches to match whichever side of the row is taller.
function Cell({
  row,
  props,
  dim,
}: {
  row: TeamRosterRow | undefined;
  props: MatchupRosterMatchupProps;
  // Live only's extra fade for this cell, if any (see dimFor).
  dim?: number | undefined;
}) {
  return (
    <Box
      style={{
        flex: 1,
        minWidth: 0,
        display: "grid",
        ...(dim !== undefined ? { opacity: dim } : {}),
      }}
    >
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
  const stateOf = (row: TeamRosterRow | undefined) =>
    row?.fpid !== undefined ? props.toCardData(row).gameState : undefined;
  // Live only fades a non-live player to the bye/IR level (45%) overall,
  // accounting for the fade its card already has: none more for bye/IR,
  // just the difference for a finished card (already at 70%).
  const dimFor = (row: TeamRosterRow | undefined): number | undefined => {
    if (!props.liveOnly) return undefined;
    const state = stateOf(row);
    if (state === "live" || state === "bye") return undefined;
    return state === "final" ? MUTED_CARD_OPACITY / FINAL_CARD_OPACITY : MUTED_CARD_OPACITY;
  };
  const rows = alignRosterRows(props.teamARows, props.teamBRows).filter(
    (row) => !props.liveOnly || stateOf(row.a) === "live" || stateOf(row.b) === "live",
  );

  if (props.liveOnly && rows.length === 0) {
    return (
      <Text size="sm" c="dimmed" ta="center" py="md">
        No players in this matchup are in a live game right now.
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
              <Cell row={aRow} props={props} dim={dimFor(aRow)} />
              <GlassSlotChip label={slotLabel(aRow?.slot ?? bRow?.slot)} />
              {props.teamBRows === undefined && props.teamBLoading ? (
                <SkeletonCell />
              ) : (
                <Cell row={props.teamBRows ? bRow : undefined} props={props} dim={dimFor(bRow)} />
              )}
            </Group>
          </Fragment>
        );
      })}
    </>
  );
}
