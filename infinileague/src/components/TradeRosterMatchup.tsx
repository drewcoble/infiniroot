import { Fragment } from "react";
import { Box, Group } from "@mantine/core";
import type { RosVorRow, TeamRosterRow } from "../types/season";
import { alignRosterRows } from "../lib/rosterAlignment";
import { slotLabel } from "../lib/matchupCardData";
import { ROSTER_SECTION_LABEL, rosterSection } from "./cards/cardShared";
import {
  EmptyGlassCard,
  GlassSectionDivider,
  GlassSkeletonCard,
  GlassSlotChip,
} from "./cards/GlassMatchupCard";
import { GlassTradeCard, type GlassTradeCardData, type TradeMetric } from "./cards/GlassTradeCard";

interface TradeRosterMatchupProps {
  teamARows: TeamRosterRow[];
  // undefined = no partner rows to show: either still on the way
  // (teamBLoading - skeleton cards) or no partner picked yet (blank wells).
  teamBRows: TeamRosterRow[] | undefined;
  teamBLoading: boolean;
  vorByFpid: Map<number, RosVorRow>;
  // What the cards show (the Trade tab's top switch).
  metric: TradeMetric;
  shortName: (fullName: string) => string;
  selectedA: Set<number>;
  selectedB: Set<number>;
  onToggleA: (fpid: number) => void;
  onToggleB: (fpid: number) => void;
}

function toTradeCardData(row: TeamRosterRow, vor: RosVorRow | undefined): GlassTradeCardData {
  return {
    name: row.name ?? "",
    position: row.position ?? "QB",
    positionRank: vor?.positionRank ?? 0,
    team: row.team ?? "",
    injury: row.injury,
    isRookie: row.isRookie ?? false,
    byeWeek: row.byeWeek,
    seasonPpg: vor?.actualPpg,
    rosPpg: vor?.rosPpg,
    seasonVor: vor?.actualVor,
    rosVor: vor?.rosVor,
    seasonRank: vor?.actualRank,
    rosRank: vor?.rosRank,
  };
}

// Same wrapper MatchupRosterMatchup renders every row cell into - flex: 1/
// minWidth: 0 for an even width split, grid so the card stretches to match
// whichever side of the row is taller.
function Cell({
  row,
  props,
  selected,
  onToggle,
}: {
  row: TeamRosterRow | undefined;
  props: TradeRosterMatchupProps;
  selected: Set<number>;
  onToggle: (fpid: number) => void;
}) {
  const fpid = row?.fpid;
  return (
    <Box style={{ flex: 1, minWidth: 0, display: "grid" }}>
      {row !== undefined && fpid !== undefined ? (
        <GlassTradeCard
          data={toTradeCardData(row, props.vorByFpid.get(fpid))}
          displayName={props.shortName(row.name ?? "")}
          slot={slotLabel(row.slot)}
          metric={props.metric}
          selected={selected.has(fpid)}
          onToggle={() => onToggle(fpid)}
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

// Both teams' rosters lined up by roster slot, slot chip between the two
// columns and section dividers between starters / bench / IR / taxi - the
// Matchup tab's layout (MatchupRosterMatchup.tsx), with glass Trade cards
// that a tap selects into the trade. Your roster always renders; the
// partner's column holds blank wells until a team is picked, then skeleton
// cards while their roster loads, so the two-column shape never jumps.
export function TradeRosterMatchup(props: TradeRosterMatchupProps) {
  const rows = alignRosterRows(props.teamARows, props.teamBRows);
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
              <Cell
                row={aRow}
                props={props}
                selected={props.selectedA}
                onToggle={props.onToggleA}
              />
              <GlassSlotChip label={slotLabel(aRow?.slot ?? bRow?.slot)} />
              {props.teamBRows === undefined && props.teamBLoading ? (
                <SkeletonCell />
              ) : (
                <Cell
                  row={props.teamBRows ? bRow : undefined}
                  props={props}
                  selected={props.selectedB}
                  onToggle={props.onToggleB}
                />
              )}
            </Group>
          </Fragment>
        );
      })}
    </>
  );
}
