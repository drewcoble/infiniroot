import { fillOptimalLineup, type LineupPoolEntry } from "./lineupSuggestions";
import type { RosVorRow, SlotLabel, TeamRosterRow } from "../types/season";

// Which VOR metric drives the analyzer - rosVor (rest-of-season, momentum-
// adjusted) is the default everywhere it's surfaced in the UI, since a
// trade decision is forward-looking; actualVor (season-to-date) is offered
// as a secondary "who's actually been good so far" view.
export type TradeValueMetric = "rosVor" | "actualVor";

// One team's tradeable pool - every rostered player who could plausibly
// start (currently starting or on the bench), same eligibility
// lineupSuggestions.ts's buildLineupSuggestions uses for its own pool - IR/
// TAXI players are excluded since Sleeper wouldn't let you start them
// either, and an unfilled slot row has no fpid to trade. Each entry's value
// comes off that player's own RosVorRow for the chosen metric - 0 for a
// player with no rosVor row yet (e.g. the daily cache hasn't caught up),
// same "not yet computed" fallback getRosVorBoard's own callers use.
export function buildTradePool(
  rows: TeamRosterRow[],
  vorByFpid: Map<number, RosVorRow>,
  metric: TradeValueMetric,
): LineupPoolEntry[] {
  const pool: LineupPoolEntry[] = [];
  for (const row of rows) {
    if (row.fpid === undefined || row.position === undefined) continue;
    if (row.slot === "IR" || row.slot === "TAXI") continue;
    pool.push({
      fpid: row.fpid,
      position: row.position,
      value: vorByFpid.get(row.fpid)?.[metric] ?? 0,
    });
  }
  return pool;
}

function sumValue(entries: LineupPoolEntry[]): number {
  return entries.reduce((total, entry) => total + entry.value, 0);
}

// Total value of just the players fillOptimalLineup actually assigns to a
// starting slot - bench-bound players (no slot left for them once the
// lineup fills) don't count, which is exactly the point: a player's raw
// value only matters to a lineup's value if they'd actually start.
function optimalLineupValue(pool: LineupPoolEntry[], slotCounts: Map<SlotLabel, number>): number {
  const assignments = fillOptimalLineup(pool, slotCounts);
  const valueByFpid = new Map(pool.map((entry) => [entry.fpid, entry.value]));
  let total = 0;
  for (const fpid of assignments.keys()) total += valueByFpid.get(fpid) ?? 0;
  return total;
}

export interface TradeSimulationInput {
  teamAPool: LineupPoolEntry[];
  teamASlotCounts: Map<SlotLabel, number>;
  teamBPool: LineupPoolEntry[];
  teamBSlotCounts: Map<SlotLabel, number>;
  outgoingFromA: LineupPoolEntry[];
  outgoingFromB: LineupPoolEntry[];
}

export interface TradeSideResult {
  // This side's best-possible starting lineup value, before vs. after the
  // trade - the headline number, since it accounts for whether the
  // incoming players actually crack the lineup given who's already there.
  beforeOptimalValue: number;
  afterOptimalValue: number;
  lineupImpact: number;
  // Plain sum of value sent/received, no lineup simulation - the simpler
  // "who got more value" number, shown alongside lineupImpact rather than
  // instead of it.
  rawSent: number;
  rawReceived: number;
}

export interface TradeResult {
  teamA: TradeSideResult;
  teamB: TradeSideResult;
}

// Simulates swapping outgoingFromA/outgoingFromB between two rosters and
// compares each side's optimal-lineup value before and after. Each side's
// slot counts stay fixed (a trade doesn't change how many starting slots a
// league gives you) - only the pool of players available to fill them
// changes.
export function simulateTrade(args: TradeSimulationInput): TradeResult {
  const outgoingAFpids = new Set(args.outgoingFromA.map((entry) => entry.fpid));
  const outgoingBFpids = new Set(args.outgoingFromB.map((entry) => entry.fpid));

  const newPoolA = [
    ...args.teamAPool.filter((entry) => !outgoingAFpids.has(entry.fpid)),
    ...args.outgoingFromB,
  ];
  const newPoolB = [
    ...args.teamBPool.filter((entry) => !outgoingBFpids.has(entry.fpid)),
    ...args.outgoingFromA,
  ];

  const beforeA = optimalLineupValue(args.teamAPool, args.teamASlotCounts);
  const afterA = optimalLineupValue(newPoolA, args.teamASlotCounts);
  const beforeB = optimalLineupValue(args.teamBPool, args.teamBSlotCounts);
  const afterB = optimalLineupValue(newPoolB, args.teamBSlotCounts);

  return {
    teamA: {
      beforeOptimalValue: beforeA,
      afterOptimalValue: afterA,
      lineupImpact: afterA - beforeA,
      rawSent: sumValue(args.outgoingFromA),
      rawReceived: sumValue(args.outgoingFromB),
    },
    teamB: {
      beforeOptimalValue: beforeB,
      afterOptimalValue: afterB,
      lineupImpact: afterB - beforeB,
      rawSent: sumValue(args.outgoingFromB),
      rawReceived: sumValue(args.outgoingFromA),
    },
  };
}
