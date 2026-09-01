import { v } from "convex/values";
import { query, QueryCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import { POSITIONS, positionValidator } from "../positions";
import { pointsForScoringConfig, ScoringConfig, scoringConfigFromSeason } from "../scoring";
import { expandRosterSlots, isEligibleForSlot } from "../draft/slots";

type Position = (typeof POSITIONS)[number];

export interface FaabSuggestionRow {
  fpid: number;
  name: string;
  team: string | null;
  position: Position;
  rosValue: number;
  positionRank: number;
  replacementValue: number;
  valueOverReplacement: number;
  marketValue: number;
  // Only populated when args.teamId is given.
  needMultiplier: number | null;
  suggestedBid: number | null;
  rationale: string | null;
}

// Per-game estimate blends this week's projection with season-to-date actual
// performance, trusting the projection fully for a player with no games
// played yet this season and shifting toward observed performance (floored
// at a 0.3 minimum projection weight) as the sample grows - see the plan doc
// for why: one huge/bad game shouldn't fully override projections.
function projectionWeight(gamesPlayed: number): number {
  return Math.max(1 - gamesPlayed * 0.1, 0.3);
}

// Same falloff-curve idea as convex/draftValues.ts's FALLOFF_EXPONENT
// (raw VOR over-concentrates $ at the top of the pool) - a separate tunable
// constant since FAAB bidding behavior isn't the same market as a draft
// auction; starts at the same value pending real bid data to retune against.
const FAAB_FALLOFF_EXPONENT = 0.85;

interface PlayerValue {
  fpid: number;
  name: string;
  team: string | null;
  position: Position;
  rosValue: number;
}

async function computePlayerValues(
  ctx: QueryCtx,
  args: {
    activePositions: Position[];
    week: string;
    season: string;
    scoringConfig: ScoringConfig;
    remainingWeeks: number;
  },
): Promise<Map<number, PlayerValue>> {
  const values = new Map<number, PlayerValue>();
  for (const pos of args.activePositions) {
    const [projectionRows, seasonStatsRows] = await Promise.all([
      ctx.db
        .query("projections")
        .withIndex("by_position_week", (q) =>
          q.eq("position", pos).eq("week", args.week),
        )
        .collect(),
      ctx.db
        .query("playerSeasonStats")
        .withIndex("by_position_season_scoring_teScoring_sixPointPassTds", (q) =>
          q
            .eq("position", pos)
            .eq("season", args.season)
            .eq("scoring", args.scoringConfig.scoring)
            .eq("teScoring", args.scoringConfig.teScoring)
            .eq("sixPointPassTds", args.scoringConfig.sixPointPassTds),
        )
        .collect(),
    ]);
    const seasonStatsByFpid = new Map(
      seasonStatsRows.map((row) => [row.fpid, row]),
    );

    for (const row of projectionRows) {
      const projectedPPG = pointsForScoringConfig(row, args.scoringConfig);
      const seasonStats = seasonStatsByFpid.get(row.fpid);
      const gamesPlayed = seasonStats?.gamesPlayed ?? 0;
      const actualPPG =
        gamesPlayed > 0 ? seasonStats!.totalPoints / gamesPlayed : 0;
      const weight = projectionWeight(gamesPlayed);
      const perGameEstimate =
        weight * projectedPPG + (1 - weight) * actualPPG;

      values.set(row.fpid, {
        fpid: row.fpid,
        name: row.name,
        team: row.team,
        position: pos,
        rosValue: Math.max(perGameEstimate, 0) * args.remainingWeeks,
      });
    }
  }
  return values;
}

// Replacement level among currently-available free agents, adapted from
// convex/draftValues.ts's computeDraftValues - same non-flex/FLEX/SUPERFLEX
// demand tiering, but fed the free-agent-only pool ranked by rest-of-season
// value instead of the full draft pool ranked by season points. Demand per
// position is approximated as teamCount * rosterSlots[pos] (the draft
// engine's own simplification), rather than trying to reconstruct exactly
// how many teams have a genuinely open/needy slot at this position this
// week - a reasonable starting heuristic, retune later if suggestions feel
// off in a shallow position.
function computeReplacementLevels(
  settings: Doc<"seasons">,
  activePositions: Position[],
  freeAgentsByPosition: Map<Position, PlayerValue[]>,
): Record<Position, number> {
  const nonFlexDemand = {} as Record<Position, number>;
  for (const pos of activePositions) {
    nonFlexDemand[pos] = Math.max(
      settings.teamCount * settings.rosterSlots[pos],
      0,
    );
  }

  const flexCandidates: Array<{ position: Position; value: number }> = [];
  for (const pos of settings.flexPositions) {
    const sorted = freeAgentsByPosition.get(pos) ?? [];
    for (const row of sorted.slice(nonFlexDemand[pos] ?? 0)) {
      flexCandidates.push({ position: pos, value: row.rosValue });
    }
  }
  flexCandidates.sort((a, b) => b.value - a.value);
  const flexDemand = settings.teamCount * settings.rosterSlots.FLEX;
  const flexWonCount = new Map<Position, number>();
  for (const candidate of flexCandidates.slice(0, flexDemand)) {
    flexWonCount.set(
      candidate.position,
      (flexWonCount.get(candidate.position) ?? 0) + 1,
    );
  }

  const superflexCandidates: Array<{ position: Position; value: number }> =
    [];
  for (const pos of settings.superflexPositions) {
    const sorted = freeAgentsByPosition.get(pos) ?? [];
    const alreadyClaimed =
      (nonFlexDemand[pos] ?? 0) + (flexWonCount.get(pos) ?? 0);
    for (const row of sorted.slice(alreadyClaimed)) {
      superflexCandidates.push({ position: pos, value: row.rosValue });
    }
  }
  superflexCandidates.sort((a, b) => b.value - a.value);
  const superflexDemand =
    settings.teamCount * settings.rosterSlots.SUPERFLEX;
  const superflexWonCount = new Map<Position, number>();
  for (const candidate of superflexCandidates.slice(0, superflexDemand)) {
    superflexWonCount.set(
      candidate.position,
      (superflexWonCount.get(candidate.position) ?? 0) + 1,
    );
  }

  const replacement = {} as Record<Position, number>;
  for (const pos of activePositions) {
    const sorted = freeAgentsByPosition.get(pos) ?? [];
    const rank =
      (nonFlexDemand[pos] ?? 0) +
      (flexWonCount.get(pos) ?? 0) +
      (superflexWonCount.get(pos) ?? 0) +
      1;
    const row = sorted[rank - 1] ?? sorted[sorted.length - 1];
    replacement[pos] = row?.rosValue ?? 0;
  }
  return replacement;
}

// Greedy best-players-start slot assignment: highest rest-of-season value
// first, each assigned to the first slot (in expandRosterSlots' fixed
// priority order - exact position, then SFLEX, then FLEX, then BENCH) it's
// eligible for. Good enough to identify "this team's current starter at
// position X" for the need multiplier below - not exposed anywhere else, so
// it doesn't need to match the live-draft slot assignment exactly.
function assignRosterSlots(
  roster: PlayerValue[],
  settings: Doc<"seasons">,
): Map<string, PlayerValue> {
  const slots = expandRosterSlots(settings.rosterSlots);
  const assigned = new Map<string, PlayerValue>();
  const takenSlotKeys = new Set<string>();
  const sorted = [...roster].sort((a, b) => b.rosValue - a.rosValue);
  for (const player of sorted) {
    const slot = slots.find(
      (s) =>
        !takenSlotKeys.has(s.key) &&
        isEligibleForSlot(
          player.position,
          s,
          settings.flexPositions,
          settings.superflexPositions,
        ),
    );
    if (!slot) continue;
    takenSlotKeys.add(slot.key);
    assigned.set(slot.key, player);
  }
  return assigned;
}

function weakestStarterByPosition(
  assignedSlots: Map<string, PlayerValue>,
): Partial<Record<Position, number>> {
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

// Advisory FAAB bid suggestions for every current free agent - see the plan
// doc ("In-Season Tooling: FAAB Bid Value Calculator") for the full
// derivation. Computed live (no cache table): the free-agent pool is much
// smaller than the full draft board and this is an on-demand advisory tool,
// not read on every render during a live draft the way getDraftValues is.
export const getFaabSuggestions = query({
  args: {
    seasonId: v.id("seasons"),
    teamId: v.optional(v.id("seasonTeams")),
    position: v.optional(positionValidator),
  },
  handler: async (ctx, args): Promise<{
    week: string | null;
    season: string | null;
    remainingWeeks: number;
    suggestions: FaabSuggestionRow[];
  }> => {
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
      (pos) =>
        settings.rosterSlots[pos] > 0 ||
        settings.flexPositions.includes(pos) ||
        settings.superflexPositions.includes(pos),
    );

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
    const rosteredFpids = new Set(rosteredRows.map((row) => row.fpid));

    const values = await computePlayerValues(ctx, {
      activePositions,
      week: nflState.week,
      season: nflState.season,
      scoringConfig: scoringConfigFromSeason(settings),
      remainingWeeks,
    });

    const freeAgentsByPosition = new Map<Position, PlayerValue[]>();
    for (const pos of activePositions) {
      const rows = [...values.values()]
        .filter((row) => row.position === pos && !rosteredFpids.has(row.fpid))
        .sort((a, b) => b.rosValue - a.rosValue);
      freeAgentsByPosition.set(pos, rows);
    }

    const replacementValues = computeReplacementLevels(
      settings,
      activePositions,
      freeAgentsByPosition,
    );

    const totalRemainingFaab = teams.reduce((sum, team) => {
      const budget = team.faabBudgetOverride ?? settings.faabBudget ?? 0;
      const spent = team.faabSpent ?? 0;
      return sum + Math.max(budget - spent, 0);
    }, 0);

    let totalWeight = 0;
    const weightByFpid = new Map<number, number>();
    const vorByFpid = new Map<number, number>();
    for (const pos of activePositions) {
      for (const row of freeAgentsByPosition.get(pos) ?? []) {
        const vor = Math.max(row.rosValue - replacementValues[pos], 0);
        const weight = Math.pow(vor, FAAB_FALLOFF_EXPONENT);
        vorByFpid.set(row.fpid, vor);
        weightByFpid.set(row.fpid, weight);
        totalWeight += weight;
      }
    }

    // Team-specific need multiplier - who's this team's current weakest
    // starter at each position, per assignRosterSlots' greedy assignment.
    let weakestStarter: Partial<Record<Position, number>> = {};
    let requestingTeam: Doc<"seasonTeams"> | undefined;
    let remainingFaabForTeam = 0;
    if (args.teamId) {
      requestingTeam = teams.find((team) => team._id === args.teamId);
      if (requestingTeam) {
        const teamRosterRows = rosteredRows.filter(
          (row) => row.teamId === (args.teamId as Id<"seasonTeams">),
        );
        const teamRoster = teamRosterRows
          .map((row) => values.get(row.fpid))
          .filter((v): v is PlayerValue => v !== undefined);
        weakestStarter = weakestStarterByPosition(
          assignRosterSlots(teamRoster, settings),
        );
        const budget =
          requestingTeam.faabBudgetOverride ?? settings.faabBudget ?? 0;
        remainingFaabForTeam = Math.max(
          budget - (requestingTeam.faabSpent ?? 0),
          0,
        );
      }
    }

    const suggestions: FaabSuggestionRow[] = [];
    for (const pos of activePositions) {
      if (args.position && args.position !== pos) continue;
      const rows = freeAgentsByPosition.get(pos) ?? [];
      rows.forEach((row, index) => {
        const vor = vorByFpid.get(row.fpid) ?? 0;
        const weight = weightByFpid.get(row.fpid) ?? 0;
        const marketValue =
          totalWeight > 0 ? (weight / totalWeight) * totalRemainingFaab : 0;

        let needMultiplier: number | null = null;
        let suggestedBid: number | null = null;
        let rationale: string | null = null;
        if (args.teamId && requestingTeam) {
          const weakest = weakestStarter[pos];
          if (weakest === undefined) {
            needMultiplier = 1.2;
            rationale = `No rostered ${pos} on your team right now`;
          } else if (row.rosValue > weakest) {
            needMultiplier = 1.2;
            rationale = `Upgrades your current ${pos}`;
          } else if (row.rosValue > weakest * 0.7) {
            needMultiplier = 0.9;
            rationale = `Bench depth at ${pos}`;
          } else {
            needMultiplier = 0.6;
            rationale = `${pos} already well-staffed on your team`;
          }
          suggestedBid = Math.round(
            Math.min(marketValue * needMultiplier, remainingFaabForTeam),
          );
        }

        suggestions.push({
          fpid: row.fpid,
          name: row.name,
          team: row.team,
          position: pos,
          rosValue: row.rosValue,
          positionRank: index + 1,
          replacementValue: replacementValues[pos],
          valueOverReplacement: vor,
          marketValue,
          needMultiplier,
          suggestedBid,
          rationale,
        });
      });
    }

    return {
      week: nflState.week,
      season: nflState.season,
      remainingWeeks,
      suggestions,
    };
  },
});
