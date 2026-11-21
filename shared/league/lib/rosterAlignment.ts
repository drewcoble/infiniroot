import type { SlotLabel, TeamRosterRow } from "../types/season";

// Lineup + bench slots in the backend's canonical order (see TeamRosterRow).
const LINEUP_SLOTS: SlotLabel[] = ["QB", "SUPERFLEX", "RB", "WR", "FLEX", "TE", "DST", "K", "BENCH"];

// Pairs two teams' weekly rosters into side-by-side rows for the Trade and
// Matchup tabs. Lined up slot by slot - each team's first RB against the
// other's first RB, and so on - then IR, then TAXI (Sleeper's empty taxi
// spots included). Matched by slot rather than by position in the list:
// Yahoo/ESPN rosters only have rows for rostered players, so a team with an
// unfilled starting spot (an empty QB slot) would otherwise shift every
// player below it up against the wrong slot. A side short on any slot
// (that empty QB, fewer bench or IR rows) just gets empty cells there.
export function alignRosterRows(
  teamARows: TeamRosterRow[],
  teamBRows: TeamRosterRow[] | undefined,
): Array<{ a: TeamRosterRow | undefined; b: TeamRosterRow | undefined }> {
  return [...LINEUP_SLOTS, "IR" as const, "TAXI" as const].flatMap((slot) => {
    const a = teamARows.filter((row) => row.slot === slot);
    const b = teamBRows?.filter((row) => row.slot === slot) ?? [];
    return Array.from({ length: Math.max(a.length, b.length) }, (_, index) => ({
      a: a[index],
      b: b[index],
    }));
  });
}
