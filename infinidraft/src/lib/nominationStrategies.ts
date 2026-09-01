import type { DraftTierRow, Position, ValueGap } from "../types";
import {
  expandRosterSlots,
  type RosterSlotCounts,
  type SlotDescriptor,
} from "./rosterSlots";
import { assignPicksToSlots, eligibleSlotsForPosition } from "./slotAssignment";
import {
  computeTeamBudgetStats,
  resolveTeamSalaryCap,
  type TeamBudgetStats,
} from "./teamBudget";

export interface TeamLike {
  _id: string;
  isSelf: boolean;
  salaryCapOverride?: number;
}

export interface PickLike {
  teamId: string;
  fpid: number;
  // Optional (matching Convex's own `?` field semantics, not just
  // `| undefined` - exactOptionalPropertyTypes distinguishes an absent key
  // from a present-but-undefined one) since convex/schema.ts's
  // draftPicks.price is now optional (SNAKE_DRAFT.md §3.2) - this whole
  // module is auction-only (nomination/bid strategy suggestions), so it's
  // always real for the picks passed in here in practice; see
  // computeTeamRosterFits' ?? 0 below.
  price?: number;
  position: Position;
  planSlotKey?: string;
}

export interface NominationSettings {
  salaryCap: number;
  rosterSlots: RosterSlotCounts;
  flexPositions: Position[];
  superflexPositions: Position[];
}

export interface TeamRosterFit {
  teamId: string;
  isSelf: boolean;
  openSlots: SlotDescriptor[];
  budget: TeamBudgetStats;
}

export interface NominationSuggestion {
  row: DraftTierRow;
  reason: string;
}

export interface NominationStrategyResults {
  highDemand: NominationSuggestion[];
  discount: NominationSuggestion[];
  dump: NominationSuggestion[];
}

// Per-team open roster slots + budget stats, for every team (not just
// self) - same computation LeagueTab.tsx's teamSummaries memo already does
// to render the League tab's per-team cards, extracted here as a plain
// function so the three strategies below can share it.
export function computeTeamRosterFits(
  teams: TeamLike[],
  picks: PickLike[],
  settings: NominationSettings,
): TeamRosterFit[] {
  return teams.map((team) => {
    const teamPicks = picks.filter((pick) => pick.teamId === team._id);
    const spent = teamPicks.reduce((sum, pick) => sum + (pick.price ?? 0), 0);
    const budget = computeTeamBudgetStats(
      resolveTeamSalaryCap(team, settings.salaryCap),
      settings.rosterSlots,
      teamPicks.length,
      spent,
    );
    const bySlot = assignPicksToSlots(
      teamPicks,
      settings.rosterSlots,
      settings.flexPositions,
      settings.superflexPositions,
    );
    const openSlots = expandRosterSlots(settings.rosterSlots).filter(
      (slot) => !bySlot.has(slot.key),
    );
    return { teamId: team._id, isSelf: team.isSelf, openSlots, budget };
  });
}

// A team sitting on a $1 maxBid has no real bidding power left, even if its
// raw `remaining` looks big - maxBid already nets out $1 reserved per other
// open slot, so a team spread thin across many slots correctly doesn't
// count as a threat on any one player.
export const MIN_REAL_MAX_BID = 2;
// Enough rivals to plausibly start a bidding war (a bidder *and* a
// counter-bidder besides you).
export const HIGH_DEMAND_MIN_RIVALS = 2;
// "Great Time to Act"'s cooled-demand signal is the complement of High
// Demand: at most one rival could still contest it.
export const COOL_DEMAND_MAX_RIVALS = 1;
// Players You Don't Need only needs *a* buyer to exist - the goal there is
// "don't waste this pick", not "start a war".
export const DUMP_MIN_RIVALS = 1;

export interface PositionDemand {
  position: Position;
  count: number;
  avgRemaining: number;
}

export function computeOpponentDemand(
  fits: TeamRosterFit[],
  position: Position,
  flexPositions: Position[],
  superflexPositions: Position[],
): PositionDemand {
  const demanding = fits.filter(
    (fit) =>
      !fit.isSelf &&
      fit.budget.maxBid >= MIN_REAL_MAX_BID &&
      eligibleSlotsForPosition(position, fit.openSlots, flexPositions, superflexPositions)
        .length > 0,
  );
  const avgRemaining = demanding.length
    ? Math.round(
        demanding.reduce((sum, fit) => sum + fit.budget.remaining, 0) /
          demanding.length,
      )
    : 0;
  return { position, count: demanding.length, avgRemaining };
}

export function buildDemandByPosition(
  positions: Position[],
  fits: TeamRosterFit[],
  flexPositions: Position[],
  superflexPositions: Position[],
): Map<Position, PositionDemand> {
  const map = new Map<Position, PositionDemand>();
  for (const position of positions) {
    map.set(
      position,
      computeOpponentDemand(fits, position, flexPositions, superflexPositions),
    );
  }
  return map;
}

export function selfIsFullAt(
  fits: TeamRosterFit[],
  position: Position,
  flexPositions: Position[],
  superflexPositions: Position[],
): boolean {
  const self = fits.find((fit) => fit.isSelf);
  if (!self) return false;
  return (
    eligibleSlotsForPosition(position, self.openSlots, flexPositions, superflexPositions)
      .length === 0
  );
}

// `ranked` must already be filtered to only rows that qualify for this
// strategy, and sorted best-suggestion-first. Pass 1 takes the single
// best-ranked row per not-yet-used position, diversifying across up to
// `limit` distinct positions - three players at three different positions
// give real optionality (maybe the top suggestion gets manually nominated
// by someone else a second later), where three same-position options
// don't. Pass 2 only runs if pass 1 didn't fill `limit`, and backfills with
// the next-best *still-qualifying* rows regardless of position repeats - it
// never reaches outside `ranked` into non-qualifying rows, since
// suggesting a player who doesn't meet the strategy's own criterion would
// be actively misleading, not just a lower-quality suggestion.
export function diversifyByPosition(
  ranked: DraftTierRow[],
  reasonFor: (row: DraftTierRow) => string,
  limit: number,
): NominationSuggestion[] {
  const chosen: NominationSuggestion[] = [];
  const usedPositions = new Set<Position>();
  for (const row of ranked) {
    if (chosen.length >= limit) break;
    if (usedPositions.has(row.position)) continue;
    usedPositions.add(row.position);
    chosen.push({ row, reason: reasonFor(row) });
  }
  if (chosen.length < limit) {
    const chosenFpids = new Set(chosen.map((c) => c.row.fpid));
    for (const row of ranked) {
      if (chosen.length >= limit) break;
      if (chosenFpids.has(row.fpid)) continue;
      chosenFpids.add(row.fpid);
      chosen.push({ row, reason: reasonFor(row) });
    }
  }
  return chosen;
}

export const SUGGESTIONS_PER_STRATEGY = 3;

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// Top remaining tier a candidate must be in for any strategy below - "a top
// remaining player", not a $1 scrub who happens to be the best one left at
// a thin position.
const MAX_CANDIDATE_TIER = 3;

export function selectHighDemand(
  available: DraftTierRow[],
  demandByPosition: Map<Position, PositionDemand>,
  limit: number = SUGGESTIONS_PER_STRATEGY,
): NominationSuggestion[] {
  const ranked = available
    .filter((row) => {
      const demand = demandByPosition.get(row.position);
      return (
        row.tier <= MAX_CANDIDATE_TIER &&
        !!demand &&
        demand.count >= HIGH_DEMAND_MIN_RIVALS
      );
    })
    .sort((a, b) => {
      const da = demandByPosition.get(a.position)!;
      const db = demandByPosition.get(b.position)!;
      return (
        db.count - da.count ||
        a.tierRank - b.tierRank ||
        db.avgRemaining - da.avgRemaining ||
        a.fpid - b.fpid
      );
    });
  const reasonFor = (row: DraftTierRow) => {
    const demand = demandByPosition.get(row.position)!;
    return `${plural(demand.count, "team")} need ${row.position} · avg $${demand.avgRemaining} left`;
  };
  return diversifyByPosition(ranked, reasonFor, limit);
}

export function selectGreatTimeToAct(
  available: DraftTierRow[],
  fits: TeamRosterFit[],
  demandByPosition: Map<Position, PositionDemand>,
  valueGapByFpid: Map<number, ValueGap>,
  flexPositions: Position[],
  superflexPositions: Position[],
  limit: number = SUGGESTIONS_PER_STRATEGY,
): NominationSuggestion[] {
  const isUndervalued = (row: DraftTierRow) =>
    valueGapByFpid.get(row.fpid)?.direction === "undervalued";
  const isCool = (row: DraftTierRow) =>
    (demandByPosition.get(row.position)?.count ?? 0) <= COOL_DEMAND_MAX_RIVALS;
  const signalCount = (row: DraftTierRow) =>
    (isUndervalued(row) ? 1 : 0) + (isCool(row) ? 1 : 0);

  // A discount is only worth surfacing here if the self team could actually
  // use it - a cheap/undervalued player at a position you've already
  // filled (including flex/superflex) belongs in "Players You Don't Need"
  // instead, not here.
  const ranked = available
    .filter(
      (row) =>
        row.tier <= MAX_CANDIDATE_TIER &&
        signalCount(row) > 0 &&
        !selfIsFullAt(fits, row.position, flexPositions, superflexPositions),
    )
    .sort(
      (a, b) =>
        signalCount(b) - signalCount(a) ||
        b.dollarValue - a.dollarValue ||
        a.tierRank - b.tierRank ||
        a.fpid - b.fpid,
    );

  const reasonFor = (row: DraftTierRow) => {
    const under = isUndervalued(row);
    const cool = isCool(row);
    const rivals = demandByPosition.get(row.position)?.count ?? 0;
    if (under && cool) {
      return `Undervalued & only ${plural(rivals, "rival")} need ${row.position}`;
    }
    if (under) return "Undervalued — ADP hasn't caught up";
    return `Only ${plural(rivals, "rival")} need ${row.position} — low competition expected`;
  };
  return diversifyByPosition(ranked, reasonFor, limit);
}

export function selectPlayersYouDontNeed(
  available: DraftTierRow[],
  fits: TeamRosterFit[],
  demandByPosition: Map<Position, PositionDemand>,
  flexPositions: Position[],
  superflexPositions: Position[],
  limit: number = SUGGESTIONS_PER_STRATEGY,
): NominationSuggestion[] {
  const ranked = available
    .filter((row) => {
      const demand = demandByPosition.get(row.position);
      return (
        selfIsFullAt(fits, row.position, flexPositions, superflexPositions) &&
        !!demand &&
        demand.count >= DUMP_MIN_RIVALS
      );
    })
    .sort((a, b) => {
      const da = demandByPosition.get(a.position)!;
      const db = demandByPosition.get(b.position)!;
      return (
        db.count - da.count ||
        a.tierRank - b.tierRank ||
        b.dollarValue - a.dollarValue ||
        a.fpid - b.fpid
      );
    });
  const reasonFor = (row: DraftTierRow) => {
    const demand = demandByPosition.get(row.position)!;
    return `You're full at ${row.position} — ${plural(demand.count, "rival")} still need it`;
  };
  return diversifyByPosition(ranked, reasonFor, limit);
}

export function computeNominationSuggestions(args: {
  available: DraftTierRow[];
  teams: TeamLike[];
  picks: PickLike[];
  settings: NominationSettings;
  valueGapByFpid: Map<number, ValueGap>;
}): NominationStrategyResults {
  const fits = computeTeamRosterFits(args.teams, args.picks, args.settings);
  const positions = Array.from(new Set(args.available.map((row) => row.position)));
  const demandByPosition = buildDemandByPosition(
    positions,
    fits,
    args.settings.flexPositions,
    args.settings.superflexPositions,
  );
  return {
    highDemand: selectHighDemand(args.available, demandByPosition),
    discount: selectGreatTimeToAct(
      args.available,
      fits,
      demandByPosition,
      args.valueGapByFpid,
      args.settings.flexPositions,
      args.settings.superflexPositions,
    ),
    dump: selectPlayersYouDontNeed(
      args.available,
      fits,
      demandByPosition,
      args.settings.flexPositions,
      args.settings.superflexPositions,
    ),
  };
}
