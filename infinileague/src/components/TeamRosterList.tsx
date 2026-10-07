import { Fragment } from "react";
import { Stack } from "@mantine/core";
import type { TeamRosterRow } from "../types/season";
import { slotLabel } from "../lib/matchupCardData";
import { ROSTER_SECTION_LABEL, rosterSection, type GlassMatchupCardData } from "./cards/cardShared";
import { GlassSectionDivider } from "./cards/GlassMatchupCard";
import {
  EmptyGlassRosterCard,
  GlassRosterCard,
  GlassRosterSkeletonCard,
} from "./cards/GlassRosterCard";

interface TeamRosterListProps {
  rows: TeamRosterRow[];
  toCardData: (row: TeamRosterRow) => GlassMatchupCardData;
  // Shared meter scale for every card in the list (see meterScale.ts).
  scaleMax: number;
}

// My Team's roster as full-width glass cards (components/cards/
// GlassRosterCard.tsx) in roster order - starters, then bench, IR, and
// taxi, each set off with a labeled divider. Unfilled slots are recessed
// "Empty" wells; long-press any card for the player's detail card.
// Starters and bench keep the order they came in (lineup order, then
// bench); IR and taxi follow, grouped, so each section is contiguous.
const SECTION_ORDER = { starters: 0, bench: 0, ir: 1, taxi: 2 } as const;

export function TeamRosterList({ rows, toCardData, scaleMax }: TeamRosterListProps) {
  const ordered = [...rows].sort(
    (a, b) => SECTION_ORDER[rosterSection(a.slot)] - SECTION_ORDER[rosterSection(b.slot)],
  );
  return (
    <Stack gap={8}>
      {ordered.map((row, index) => {
        const section = rosterSection(row.slot);
        const startsSection = index > 0 && rosterSection(ordered[index - 1]!.slot) !== section;
        const slot = slotLabel(row.slot);
        return (
          <Fragment key={row.fpid ?? `empty-${row.slot}-${index}`}>
            {startsSection && <GlassSectionDivider label={ROSTER_SECTION_LABEL[section]} />}
            {row.fpid !== undefined ? (
              <GlassRosterCard data={toCardData(row)} slot={slot} scaleMax={scaleMax} />
            ) : (
              <EmptyGlassRosterCard slot={slot} />
            )}
          </Fragment>
        );
      })}
    </Stack>
  );
}

// Placeholder rows while the roster loads (first load, or a week change) -
// a fixed count since the roster's real length isn't known yet.
const SKELETON_ROWS = 9;

export function TeamRosterListSkeleton() {
  return (
    <Stack gap={8}>
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <GlassRosterSkeletonCard key={index} />
      ))}
    </Stack>
  );
}
