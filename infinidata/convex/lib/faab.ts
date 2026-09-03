import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { POSITIONS } from "../positions";
import { scoringConfigFromSeason } from "../scoring";
import { expandRosterSlots, isEligibleForSlot } from "./rosterSlots";
import {
  computeReplacementLevels,
  findInjuryBoosts,
  forwardRate,
  gatherPlayerForms,
  type ValuedPlayer,
} from "./playerValue";

type Position = (typeof POSITIONS)[number];

export interface FaabSuggestionRow {
  fpid: number;
  name: string;
  team: string | null;
  position: Position;
  rosValue: number;
  positionRank: number;
  // Same VOR concept the pre-draft value process uses (convex/draftValues.ts's
  // valueOverReplacement) - rosValue above this position's replacement level
  // among currently-available free agents (see playerValue.ts's
  // computeReplacementLevels). Genuinely unclamped (can go negative for a
  // below-replacement player), same reason draftValues.ts's own field is -
  // it's a ranking/tiebreak signal, not a dollar amount.
  valueOverReplacement: number;
  // Demand across the whole league, not just the requester - how many teams
  // have a real roster gap this player would fill, and the single largest
  // gap among them (a rough "what would the winning bid look like" read).
  // 0/0 means nobody actually needs this player right now, whatever their
  // raw rosValue is - see computeFaabSuggestions' header comment for why
  // that's the point, not a bug.
  demandCount: number;
  topDemandValue: number;
  // myValue/suggestedBid/rationale are only populated when args.teamId is
  // given - the value/bid FROM THAT TEAM's own perspective and own
  // remaining budget, never a share of the league's combined FAAB (see
  // this file's header comment for why the old model did that and why it
  // was wrong).
  myValue: number | null;
  suggestedBid: number | null;
  rationale: string | null;
  // Set when this row's value includes an injury-driven backup boost (see
  // playerValue.ts's findInjuryBoosts) - surfaced so the UI can explain an
  // otherwise-surprising number rather than just asserting it.
  boostReason: string | null;
}

export interface FaabSuggestionsResult {
  week: string | null;
  season: string | null;
  remainingWeeks: number;
  suggestions: FaabSuggestionRow[];
}

// ---- Per-player value: cache-first, live-compute fallback ----

interface PlayerValueEntry {
  fpid: number;
  name: string;
  team: string | null;
  position: Position;
  rosValue: number;
  valueOverReplacement: number;
  boostReason: string | null;
}

// Prefers convex/rosVor.ts's daily-cron cache - it computes this exact same
// momentum/injury-boost value for every rosterable player already, so
// reading it here avoids redoing convex/lib/playerValue.ts's live
// gather-forms/injury-boost work (the expensive O(positions * weeks) reads)
// on every single FAAB query. Returns null on a genuine cache miss (empty
// for this season/week - a brand-new league before the next cron cycle) so
// the caller can fall back to computing live, same convention convex/
// draftValues.ts's getRealDraftValues already uses for its own cache.
async function loadCachedPlayerValues(
  ctx: QueryCtx,
  args: { seasonId: Id<"seasons">; week: string },
): Promise<Map<number, PlayerValueEntry> | null> {
  const rows = await ctx.db
    .query("rosVorSnapshots")
    .withIndex("by_season_week", (q) => q.eq("seasonId", args.seasonId).eq("week", args.week))
    .collect();
  if (rows.length === 0) return null;

  const values = new Map<number, PlayerValueEntry>();
  for (const row of rows) {
    // rosValue predates some rows (written before that field existed) -
    // treated as absent for that one player rather than invalidating the
    // whole cache, since every row going forward always has it.
    if (row.rosValue === undefined) continue;
    values.set(row.fpid, {
      fpid: row.fpid,
      name: row.name,
      team: row.team,
      position: row.position,
      rosValue: row.rosValue,
      valueOverReplacement: row.rosVor,
      boostReason: row.boostReason ?? null,
    });
  }
  return values.size > 0 ? values : null;
}

// Same computation convex/rosVor.ts's own refresh does for its "forward"
// side (momentum-adjusted rosValue, injury boost, free-agent-pool
// replacement level) - kept here rather than imported from that file since
// rosVor.ts is a cron-triggered mutation, not designed for reuse, and this
// only needs the "ros" half (not actualVor, which FAAB has no use for).
async function computeLivePlayerValues(
  ctx: QueryCtx,
  args: {
    settings: Doc<"seasons">;
    activePositions: Position[];
    week: string;
    scoringConfig: ReturnType<typeof scoringConfigFromSeason>;
    remainingWeeks: number;
  },
): Promise<Map<number, PlayerValueEntry>> {
  const forms = await gatherPlayerForms(ctx, {
    activePositions: args.activePositions,
    week: args.week,
    scoringConfig: args.scoringConfig,
  });
  const boosts = await findInjuryBoosts(ctx, { forms });

  const rosValueByFpid = new Map<number, number>();
  for (const form of forms.values()) {
    let value = forwardRate(form) * args.remainingWeeks;
    const boost = boosts.get(form.fpid);
    if (boost) {
      const boostedWeeks = Math.min(boost.boostedWeeks, args.remainingWeeks);
      value += Math.max(boost.boostedRate - forwardRate(form), 0) * boostedWeeks;
    }
    rosValueByFpid.set(form.fpid, value);
  }

  // Full pool (rostered + free agent), not free-agent-only - see
  // convex/rosVor.ts's identical comment on why computeReplacementLevels
  // needs the undivided pool (its demand-offset math double-counts if fed
  // a pool that's already had rostered players filtered out).
  const allPlayersByPosition = new Map<Position, ValuedPlayer[]>();
  for (const pos of args.activePositions) {
    const rows = [...forms.values()]
      .filter((form) => form.position === pos)
      .map((form) => ({ fpid: form.fpid, name: form.name, team: form.team, position: form.position, rosValue: rosValueByFpid.get(form.fpid) ?? 0 }))
      .sort((a, b) => b.rosValue - a.rosValue);
    allPlayersByPosition.set(pos, rows);
  }
  const replacementValues = computeReplacementLevels(args.settings, args.activePositions, allPlayersByPosition);

  const values = new Map<number, PlayerValueEntry>();
  for (const form of forms.values()) {
    const rosValue = rosValueByFpid.get(form.fpid) ?? 0;
    values.set(form.fpid, {
      fpid: form.fpid,
      name: form.name,
      team: form.team,
      position: form.position,
      rosValue,
      valueOverReplacement: rosValue - replacementValues[form.position],
      boostReason: boosts.get(form.fpid)?.reason ?? null,
    });
  }
  return values;
}

// ---- Demand against every team's real rosters ----

// Greedy best-players-start slot assignment: highest rest-of-season value
// first, each assigned to the first slot (in expandRosterSlots' fixed
// priority order - exact position, then SFLEX, then FLEX, then BENCH) it's
// eligible for. Good enough to identify "this team's current starter at
// position X" - not exposed anywhere else, so it doesn't need to match the
// live-draft slot assignment exactly.
function assignRosterSlots(roster: ValuedPlayer[], settings: Doc<"seasons">): Map<string, ValuedPlayer> {
  const slots = expandRosterSlots(settings.rosterSlots);
  const assigned = new Map<string, ValuedPlayer>();
  const takenSlotKeys = new Set<string>();
  const sorted = [...roster].sort((a, b) => b.rosValue - a.rosValue);
  for (const player of sorted) {
    const slot = slots.find(
      (s) => !takenSlotKeys.has(s.key) && isEligibleForSlot(player.position, s, settings.flexPositions, settings.superflexPositions),
    );
    if (!slot) continue;
    takenSlotKeys.add(slot.key);
    assigned.set(slot.key, player);
  }
  return assigned;
}

function weakestStarterByPosition(assignedSlots: Map<string, ValuedPlayer>): Partial<Record<Position, number>> {
  const weakest: Partial<Record<Position, number>> = {};
  for (const [slotKey, player] of assignedSlots) {
    if (slotKey.startsWith("BN")) continue;
    const current = weakest[player.position];
    if (current === undefined || player.rosValue < current) {
      weakest[player.position] = player.rosValue;
    }
  }
  return weakest;
}

// How much of MY OWN value to actually offer, scaled by competitive
// pressure from other teams that also have a gap here - no competing team
// means I can lowball far below my own valuation; a rival valuing this
// player as much or more than me means I likely need to approach my own
// ceiling to win it. Starting curve, not calibrated against real bid
// outcomes yet.
function competitionFraction(myValue: number, rivalDemandValues: number[]): number {
  if (myValue <= 0) return 0;
  const competingRivals = rivalDemandValues.filter((v) => v > 0);
  if (competingRivals.length === 0) return 0.15;
  const strongestRival = Math.max(...competingRivals);
  const pressure = Math.min(strongestRival / myValue, 1);
  const rivalCountBump = Math.min((competingRivals.length - 1) * 0.05, 0.15);
  return Math.min(0.15 + 0.7 * pressure + rivalCountBump, 0.9);
}

// K/DST get a hard discount the VOR-over-replacement math above would never
// find on its own - real FAAB managers don't chase these regardless of the
// raw point gap, because week-to-week output is mostly matchup noise (low
// trust in the signal persisting) and there's always ample streamable
// replacement supply on waivers (no real scarcity to bid up). This is a
// market-convention fact, not a stats-derived one, so it's applied as an
// explicit dampener + hard ceiling on the DOLLAR amount only - rosValue/
// demandCount/myValue upstream stay undamped, since "this DST has a great
// matchup" is still real, useful signal for the rationale/demand columns,
// it just shouldn't translate into real budget. Tuned to roughly: K almost
// always $0-1, DST streaming $1-2 with a rare standout up around $5-6 -
// starting numbers, not calibrated against real bid outcomes yet.
const BID_DAMPENER_BY_POSITION: Partial<Record<Position, number>> = {
  K: 0.03,
  DST: 0.2,
};
const BID_CEILING_BY_POSITION: Partial<Record<Position, number>> = {
  K: 1,
  DST: 6,
};

// Advisory FAAB bid suggestions for every current free agent.
//
// Replaces an earlier version of this formula that was a near-copy of the
// draft-day auction engine (convex/draftValues.ts): same VOR-over-
// replacement idea, same weight-and-split-a-pot allocation. That's wrong
// for FAAB - a live auction really is one shared pot split in real time,
// but FAAB is independent blind bidding from each team's own budget, so a
// player should only carry value where a specific team has a specific gap,
// priced against THAT team's own remaining budget - never a share of the
// league's combined FAAB. This version instead: (1) values each player off
// a recency/volume-aware momentum read on top of their forward projection
// rather than a flat season-to-date average - normally read straight from
// convex/rosVor.ts's daily cache rather than recomputed live (see
// loadCachedPlayerValues) - (2) includes a time-boxed value bump for a free
// agent plausibly inheriting a just-injured teammate's workload, (3)
// computes demand by comparing that value against every team's own actual
// current weakest starter, and (4) prices a suggested bid off the
// requesting team's own value and budget, scaled by how much competing
// demand exists elsewhere in the league.
//
// Lives here rather than directly in convex/infinileague/season/faabValues.ts
// (its only consumer, now that infinidraft's own Free Agents tab has moved
// to infinileague) since it's still generic library logic, not
// infinileague-specific - kept out of that app's folder the same way
// convex/lib/rosterSlots.ts is.
export async function computeFaabSuggestions(
  ctx: QueryCtx,
  args: {
    seasonId: Id<"seasons">;
    teamId?: Id<"seasonTeams"> | undefined;
    position?: Position | undefined;
  },
): Promise<FaabSuggestionsResult> {
  const settings = await ctx.db.get(args.seasonId);
  if (!settings) {
    throw new Error("League not found.");
  }

  const nflState = await ctx.db.query("nflState").first();
  if (!nflState || nflState.seasonType !== "regular") {
    return { week: null, season: null, remainingWeeks: 0, suggestions: [] };
  }
  const remainingWeeks = Math.max(18 - Number(nflState.week) + 1, 0);

  const activePositions = POSITIONS.filter(
    (pos) => settings.rosterSlots[pos] > 0 || settings.flexPositions.includes(pos) || settings.superflexPositions.includes(pos),
  );
  const scoringConfig = scoringConfigFromSeason(settings);

  const [rosteredRows, teams] = await Promise.all([
    ctx.db
      .query("rosterPlayers")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .collect(),
    ctx.db
      .query("seasonTeams")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .collect(),
  ]);
  const rosteredFpidsByTeam = new Map<Id<"seasonTeams">, Set<number>>();
  const rosteredFpids = new Set<number>();
  for (const row of rosteredRows) {
    rosteredFpids.add(row.fpid);
    const set = rosteredFpidsByTeam.get(row.teamId) ?? new Set<number>();
    set.add(row.fpid);
    rosteredFpidsByTeam.set(row.teamId, set);
  }

  const playerValues =
    (await loadCachedPlayerValues(ctx, { seasonId: args.seasonId, week: nflState.week })) ??
    (await computeLivePlayerValues(ctx, {
      settings,
      activePositions,
      week: nflState.week,
      scoringConfig,
      remainingWeeks,
    }));

  // Every team's current starters, valued the same way as free agents -
  // this is what demand gets computed against below.
  const weakestStarterByTeam = new Map<Id<"seasonTeams">, Partial<Record<Position, number>>>();
  for (const team of teams) {
    const roster = [...(rosteredFpidsByTeam.get(team._id) ?? [])]
      .map((fpid) => playerValues.get(fpid))
      .filter((v): v is PlayerValueEntry => v !== undefined);
    weakestStarterByTeam.set(team._id, weakestStarterByPosition(assignRosterSlots(roster, settings)));
  }

  const freeAgentsByPosition = new Map<Position, PlayerValueEntry[]>();
  for (const pos of activePositions) {
    const rows = [...playerValues.values()]
      .filter((v) => v.position === pos && !rosteredFpids.has(v.fpid))
      .sort((a, b) => b.rosValue - a.rosValue);
    freeAgentsByPosition.set(pos, rows);
  }

  const requestingTeam = args.teamId ? teams.find((team) => team._id === args.teamId) : undefined;
  const remainingFaabForTeam = requestingTeam
    ? Math.max((requestingTeam.faabBudgetOverride ?? settings.faabBudget ?? 0) - (requestingTeam.faabSpent ?? 0), 0)
    : 0;

  const suggestions: FaabSuggestionRow[] = [];
  for (const pos of activePositions) {
    if (args.position && args.position !== pos) continue;
    const rows = freeAgentsByPosition.get(pos) ?? [];
    rows.forEach((row, index) => {
      const demandValuesByTeam = teams.map((team) => {
        const weakest = weakestStarterByTeam.get(team._id)?.[pos];
        return { teamId: team._id, value: Math.max(row.rosValue - (weakest ?? 0), 0) };
      });
      const demandCount = demandValuesByTeam.filter((d) => d.value > 0).length;
      const topDemandValue = demandValuesByTeam.reduce((max, d) => Math.max(max, d.value), 0);

      let myValue: number | null = null;
      let suggestedBid: number | null = null;
      let rationale: string | null = null;
      if (requestingTeam) {
        myValue = demandValuesByTeam.find((d) => d.teamId === requestingTeam._id)?.value ?? 0;
        const rivalDemands = demandValuesByTeam.filter((d) => d.teamId !== requestingTeam._id).map((d) => d.value);
        const dampener = BID_DAMPENER_BY_POSITION[pos] ?? 1;
        const ceiling = BID_CEILING_BY_POSITION[pos] ?? Infinity;
        suggestedBid = Math.round(
          Math.min(myValue * competitionFraction(myValue, rivalDemands) * dampener, ceiling, remainingFaabForTeam),
        );

        const weakest = weakestStarterByTeam.get(requestingTeam._id)?.[pos];
        if (myValue <= 0) {
          rationale = weakest === undefined ? `No rostered ${pos} on your team, but still no real upgrade` : `${pos} already well-staffed on your team`;
        } else if (weakest === undefined) {
          rationale = `No rostered ${pos} on your team right now`;
        } else {
          rationale = `Upgrades your current ${pos}`;
        }
      }

      if (row.boostReason) {
        rationale = rationale ? `${rationale} - ${row.boostReason}` : row.boostReason;
      }

      suggestions.push({
        fpid: row.fpid,
        name: row.name,
        team: row.team,
        position: pos,
        rosValue: row.rosValue,
        positionRank: index + 1,
        valueOverReplacement: row.valueOverReplacement,
        demandCount,
        topDemandValue,
        myValue,
        suggestedBid,
        rationale,
        boostReason: row.boostReason,
      });
    });
  }

  return {
    week: nflState.week,
    season: nflState.season,
    remainingWeeks,
    suggestions,
  };
}
