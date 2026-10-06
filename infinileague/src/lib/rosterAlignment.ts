import type { TeamRosterRow } from "../types/season";

// Pairs two teams' weekly rosters into side-by-side rows for the Trade and
// Matchup tabs. Lined up index-for-index within each section - lineup +
// bench first (unfilled slots kept, so an empty bench spot on one side
// still gets a row), then IR, then TAXI (Sleeper's empty taxi spots
// included) - so a team with more bench rows (Yahoo has no fixed bench
// count) or more IR players never pushes the other team's IR/taxi players
// up against the wrong slots; the shorter side just gets empty cells at
// the end of that section.
export function alignRosterRows(
  teamARows: TeamRosterRow[],
  teamBRows: TeamRosterRow[] | undefined,
): Array<{ a: TeamRosterRow | undefined; b: TeamRosterRow | undefined }> {
  const sections = [
    (row: TeamRosterRow) => row.slot !== undefined && row.slot !== "IR" && row.slot !== "TAXI",
    (row: TeamRosterRow) => row.slot === "IR",
    (row: TeamRosterRow) => row.slot === "TAXI",
  ];
  return sections.flatMap((inSection) => {
    const a = teamARows.filter(inSection);
    const b = teamBRows?.filter(inSection) ?? [];
    return Array.from({ length: Math.max(a.length, b.length) }, (_, index) => ({
      a: a[index],
      b: b[index],
    }));
  });
}
