// How many rounds a single-elimination bracket of `teamCount` needs, byes
// filling it out to a power of two.
export function bracketRoundCount(teamCount: number): number {
  return teamCount > 1 ? Math.ceil(Math.log2(teamCount)) : 0;
}
