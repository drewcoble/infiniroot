import type { RosVorRow } from "../types/season";

// Season-to-date position rank per player ("WR12" so far this season):
// the rosVOR board ranked by actualVor within each position - the
// season-to-date counterpart of the board's own positionRank, which ranks
// by rosVor. The board only carries an overall actualRank, so the
// long-press cards' Season | ROS tables derive this one here.
export function seasonPositionRanks(rows: RosVorRow[] | undefined): Map<number, number> {
  const ranks = new Map<number, number>();
  const byPosition = new Map<string, RosVorRow[]>();
  for (const row of rows ?? []) {
    const list = byPosition.get(row.position) ?? [];
    list.push(row);
    byPosition.set(row.position, list);
  }
  for (const list of byPosition.values()) {
    list
      .sort((a, b) => b.actualVor - a.actualVor)
      .forEach((row, index) => ranks.set(row.fpid, index + 1));
  }
  return ranks;
}
