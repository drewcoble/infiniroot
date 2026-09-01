import type { Doc } from "@infinidata/dataModel";
import type { Position } from "../types";
import type { ValueRankEntry } from "./valueRank";

export type KeeperRules = NonNullable<Doc<"seasons">["keeperRules"]>;
export type KeeperFormula = KeeperRules["defaultFormula"];
export type KeeperTier = KeeperRules["tiers"][number];
export type KeeperRoundFormula = NonNullable<
  KeeperRules["defaultRoundFormula"]
>;

// Mirrors the shape returned by convex/draft/history.ts's
// getPlayerPriceHistory - kept as its own type here (rather than derived
// from the query's return type) since it's a plain Record, same as
// KeeperSearchForm.tsx already declared inline before this file existed.
export interface KeeperPriceHistoryEntry {
  // Optional since draftPicks.price is (SNAKE_DRAFT.md §3.2) - undefined
  // for a pick from a non-auction season. computeKeeperCost below already
  // treats a missing prior price the same way (no prior season at all), so
  // this needs no further change downstream.
  price: number | undefined;
  // Round counterpart to price above (SNAKE_DRAFT.md §8) - undefined for an
  // auction-season pick, or one from before round tracking existed.
  // computeKeeperCostRound treats a missing prior round the same way.
  round: number | undefined;
  season: string | undefined;
  isKeeper: boolean;
  keeperStreak: number | undefined;
  fromImmediateParent: boolean;
  // Only set when the source pick was teamAssignmentConfirmed (see
  // schema.ts) - a manually-entered end-of-season roster, not just wherever
  // a provider import/draft-day snapshot happened to place the player.
  teamName: string | undefined;
}

// The formula that applies to a given player: the first tier whose fpids
// contains them, or (failing that) whose positions includes theirs, else the
// league's default formula. Tiers are checked in array order - the panel
// that edits keeperRules is responsible for keeping a player's fpid out of
// more than one tier (see setKeeperTierPlayers), but a player can still fall
// under more than one tier's position list, so order matters as a tiebreak
// there too.
export function formulaForFpid(
  keeperRules: KeeperRules,
  fpid: number,
  position: Position,
): KeeperFormula {
  const tier = keeperRules.tiers.find(
    (t) => t.fpids.includes(fpid) || t.positions?.includes(position),
  );
  return tier ? tier.formula : keeperRules.defaultFormula;
}

// Round-formula counterpart to formulaForFpid above, same tier-lookup rule
// (SNAKE_DRAFT.md §8) - null when this league has never configured a round
// formula at all (every league predating costMode: "round", or a snake/
// linear league that hasn't set one up yet), same "nothing to suggest"
// signal computeKeeperCostRound below passes through to its caller.
export function roundFormulaForFpid(
  keeperRules: KeeperRules,
  fpid: number,
  position: Position,
): KeeperRoundFormula | null {
  const tier = keeperRules.tiers.find(
    (t) => t.fpids.includes(fpid) || t.positions?.includes(position),
  );
  return tier?.roundFormula ?? keeperRules.defaultRoundFormula ?? null;
}

// The suggested keeper cost for a player given their resolved formula and
// their most recent prior-season price (undefined for a player who wasn't
// drafted/kept last season, e.g. a rookie; 0 for a player manually entered
// as an undrafted/waiver pickup - see ManualPreviousSeasonModal.tsx, which
// allows a $0 price for exactly this case). Both route through
// undraftedCost rather than the multiplier/flatAdd formula below - a $0
// prior price isn't a real auction result to scale from, and letting it
// fall through would let minimumCost inflate a free pickup into a paid
// suggestion. Returns null when there's nothing to suggest - no prior price
// and no undraftedCost rule configured - so callers fall back to manual
// entry instead of showing a made-up $0.
export function computeKeeperCost(
  formula: KeeperFormula,
  priorPrice: number | undefined,
): number | null {
  if (priorPrice === undefined || priorPrice === 0) {
    return formula.undraftedCost ?? null;
  }
  const raw = formula.multiplier * priorPrice + formula.flatAdd;
  const floored =
    formula.minimumCost !== undefined
      ? Math.max(raw, formula.minimumCost)
      : raw;
  return Math.round(floored);
}

// Round-formula counterpart to computeKeeperCost above: the suggested round
// a kept player costs, given their resolved round formula and the round
// they were drafted/kept in last season (undefined for a player with no
// prior-season round on record - a rookie, or an undrafted/waiver pickup -
// see ManualPreviousSeasonModal.tsx, which leaves round blank for exactly
// this case rather than guessing one). Routes through undraftedRound
// rather than roundsEarlier - there's no prior round to subtract from, and
// leagues commonly have their own explicit rule for this case, same
// reasoning as the dollar formula's undraftedCost. Returns null when
// there's nothing to suggest - no prior round and no undraftedRound rule
// configured - so callers fall back to manual entry instead of showing a
// made-up round.
export function computeKeeperCostRound(
  formula: KeeperRoundFormula,
  priorRound: number | undefined,
): number | null {
  if (priorRound === undefined) {
    return formula.undraftedRound ?? null;
  }
  const raw = priorRound - formula.roundsEarlier;
  const minimum = formula.minimumRound ?? 1;
  return Math.max(raw, minimum);
}

// A player's projected dollarValue (the same VOR-derived currency the $
// engine already computes - convex/draftValues.ts) - used below to rank
// round-mode keeper bargains by actual projected value instead of by round
// number. Comparing round numbers directly is misleading two ways: rounds
// aren't a linear unit of value (a 1st-rounder kept in round 3 is a much
// bigger deal than a "same round gap" late in the draft, where value
// per round is nearly flat), and a round's real-world ADP can be skewed by
// position runs (e.g. a QB glut making an early round's *average* value
// look worse than a later one). Ranking by dollarValue against a rank
// (not ADP) baseline sidesteps both. ValueRankEntry/sortValuesDescending
// moved to valueRank.ts - PlayersTable.tsx's snake/linear "vs ADP" column
// needs the identical pooled dollarValue rank for its own "our rank" side
// of that diff, so this is no longer keeper-specific.

// The round a player's OWN dollarValue implies, ranked against the pooled
// (not per-position, not ADP) value curve - "this player's actual
// projected production is as good as a typical round-N pick this year."
// Immune to a real-world position run distorting some round's average,
// since it only ever looks at projected value, never at what actually
// gets drafted where.
export function valueImpliedRound(
  playerValue: number,
  sortedDescending: readonly ValueRankEntry[],
  teamCount: number,
): number {
  const index = sortedDescending.findIndex((v) => v.dollarValue <= playerValue);
  const rank = index === -1 ? sortedDescending.length + 1 : index + 1;
  return Math.ceil(rank / teamCount);
}

// The inverse direction - the average dollarValue across `round`'s
// teamCount-sized rank band in the same curve ("what a typical pick in
// this round would actually get you"). null past the end of the pool
// (asking about a round deeper than there's ranked data for).
export function expectedValueAtRound(
  round: number,
  sortedDescending: readonly ValueRankEntry[],
  teamCount: number,
): number | null {
  const startIndex = (round - 1) * teamCount;
  if (startIndex >= sortedDescending.length) return null;
  const band = sortedDescending.slice(startIndex, startIndex + teamCount);
  if (band.length === 0) return null;
  return band.reduce((sum, v) => sum + v.dollarValue, 0) / band.length;
}

// Mirrors convex/draft/picks.ts's computeKeeperStreak exactly: only the
// immediately-prior season counts (a gap resets to 1), regardless of how far
// back getPlayerPriceHistory's entry for this fpid actually came from. Keep
// this in sync with that function - it exists so the client can preview the
// same number addKeeper will compute server-side without a round trip.
export function prospectiveKeeperStreak(
  entry: KeeperPriceHistoryEntry | undefined,
): number {
  if (entry?.fromImmediateParent && entry.isKeeper) {
    return (entry.keeperStreak ?? 1) + 1;
  }
  return 1;
}

// Identity key for a (team, player) keeper pair - used by
// SleeperKeeperSuggestions to tell which of Sleeper's suggested keepers are
// already real draftPicks rows, so a confirmed row drops off the suggestion
// list instead of staying there as a stale duplicate.
export function keeperPairKey(teamId: string, fpid: number): string {
  return `${teamId}:${fpid}`;
}
