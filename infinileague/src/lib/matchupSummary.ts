import type { MatchupHeaderTeam } from "../components/cards/GlassMatchupHeader";
import type { GameState } from "../components/cards/cardShared";
import type { SlotLabel, StandingsRow, TeamRosterRow } from "../types/season";

// The score-header math shared by the Matchup tab and the cross-league
// Matchups page (routes/matchups.tsx) - both build the same
// GlassMatchupHeader from two teams' weekly rosters.

// Starting lineup slots only - excludes BENCH/IR/TAXI, whose points don't
// count toward the team's total for the week. Same list teams/$teamId.tsx's
// own sumStarterPoints uses for the "My Team" header card.
export const STARTER_SLOTS = new Set<SlotLabel>([
  "QB",
  "SUPERFLEX",
  "RB",
  "WR",
  "FLEX",
  "TE",
  "DST",
  "K",
]);

export function isStarter(row: TeamRosterRow): boolean {
  return row.slot !== undefined && STARTER_SLOTS.has(row.slot);
}

export function sumStarterPoints(
  rows: TeamRosterRow[] | undefined,
  pointsFor: (row: TeamRosterRow) => number,
): number {
  if (!rows) return 0;
  return rows.reduce((total, row) => {
    if (!row.slot || !STARTER_SLOTS.has(row.slot)) return total;
    return total + pointsFor(row);
  }, 0);
}

// How often the rosters' actual points are re-fetched from Sleeper/Yahoo
// while a game is being played - matches the live poll's own cadence
// (convex/crons.ts), which is what moves the game clocks.
export const LIVE_REFRESH_MS = 2 * 60 * 1000;

// Rough win read off the two teams' live-projected totals - a logistic
// curve on the point differential, not a real variance model (no per-player
// score distributions are computed anywhere in this codebase), just enough
// to turn "who's projected ahead" into a percentage instead of a bare point
// gap. WIN_PROB_SCALE tunes how fast it saturates: a 15-point lead reads as
// ~73%, a 30-point lead as ~88%.
const WIN_PROB_SCALE = 15;

export function winProbability(projA: number, projB: number): number {
  return 1 / (1 + Math.exp(-(projA - projB) / WIN_PROB_SCALE));
}

// One side of the header: score, live projection, and how many starters
// are live / still to play. `gameStateFor` is each row's card game state
// (see lib/matchupCardData.ts's toMatchupCardData). `standing` adds the
// rank badge before the name.
export function matchupHeaderTeam(
  name: string,
  rows: TeamRosterRow[] | undefined,
  actual: number,
  proj: number,
  gameStateFor: (row: TeamRosterRow) => GameState,
  standing?: StandingsRow | undefined,
): MatchupHeaderTeam {
  const states = (rows ?? [])
    .filter((row) => row.fpid !== undefined && row.slot && STARTER_SLOTS.has(row.slot))
    .map(gameStateFor);
  const liveCount = states.filter((state) => state === "live").length;
  const toPlayCount = states.filter((state) => state === "pre").length;
  // Once every starter's game is over the live projection just equals the
  // final score - show the pregame projection instead, so "Proj" still
  // says what the team was expected to put up. (The win probability keeps
  // using the live projection either way.)
  const allFinal = liveCount === 0 && toPlayCount === 0;
  return {
    name,
    actualPoints: actual,
    projectedPoints: allFinal ? sumStarterPoints(rows, (row) => row.projectedPoints ?? 0) : proj,
    liveCount,
    toPlayCount,
    ...(standing ? { rank: { value: standing.rank } } : {}),
  };
}

// The header's line once every game of the week is over.
export function matchupResult(
  nameA: string,
  actualA: number,
  nameB: string,
  actualB: number,
): string {
  return actualA === actualB
    ? "Final · Tied"
    : `Final · ${actualA > actualB ? nameA : nameB} won by ${Math.abs(actualA - actualB).toFixed(2)}`;
}
