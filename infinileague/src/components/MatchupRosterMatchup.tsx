import { Box, Group, Text } from "@mantine/core";
import type { TeamRosterRow } from "../types/season";
import { alignRosterRows } from "../lib/rosterAlignment";
import { slotLabel } from "../lib/matchupCardData";
import { Fragment } from "react";
import { ROSTER_SECTION_LABEL, rosterSection, type GlassMatchupCardData } from "./cards/cardShared";
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

// How far Live only fades the non-live player in a row with a live one.
const LIVE_ONLY_DIM = 0.45;

// Same wrapper both TradeRosterMatchup and this component render every row
// cell into - flex: 1/minWidth: 0 for an even width split, grid so the card
// stretches to match whichever side of the row is taller.
function Cell({
  row,
  props,
  dimmed = false,
}: {
  row: TeamRosterRow | undefined;
  props: MatchupRosterMatchupProps;
  dimmed?: boolean;
}) {
  return (
    <Box
      style={{
        flex: 1,
        minWidth: 0,
        display: "grid",
        ...(dimmed ? { opacity: LIVE_ONLY_DIM } : {}),
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
  const isLive = (row: TeamRosterRow | undefined) =>
    row?.fpid !== undefined && props.toCardData(row).gameState === "live";
  const rows = alignRosterRows(props.teamARows, props.teamBRows)
    .map((row) => ({ ...row, aLive: isLive(row.a), bLive: isLive(row.b) }))
    .filter((row) => !props.liveOnly || row.aLive || row.bLive);

  if (props.liveOnly && rows.length === 0) {
    return (
      <Text size="sm" c="dimmed" ta="center" py="md">
        No players in this matchup are in a live game right now.
      </Text>
    );
  }

  return (
    <>
      {rows.map(({ a: aRow, b: bRow, aLive, bLive }, index) => {
        const section = rosterSection(aRow?.slot ?? bRow?.slot);
        const previous = index > 0 ? rows[index - 1] : undefined;
        const startsSection =
          previous !== undefined && rosterSection(previous.a?.slot ?? previous.b?.slot) !== section;
        return (
          <Fragment key={`${aRow?.fpid ?? aRow?.slot}-${bRow?.fpid ?? bRow?.slot}-${index}`}>
            {startsSection && <GlassSectionDivider label={ROSTER_SECTION_LABEL[section]} />}
            <Group wrap="nowrap" gap="xs" align="stretch">
              <Cell row={aRow} props={props} dimmed={props.liveOnly === true && !aLive} />
              <GlassSlotChip label={slotLabel(aRow?.slot ?? bRow?.slot)} />
              {props.teamBRows === undefined && props.teamBLoading ? (
                <SkeletonCell />
              ) : (
                <Cell
                  row={props.teamBRows ? bRow : undefined}
                  props={props}
                  dimmed={props.liveOnly === true && !bLive}
                />
              )}
            </Group>
          </Fragment>
        );
      })}
    </>
  );
}
