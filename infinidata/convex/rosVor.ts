import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { POSITIONS, positionValidator } from "./positions";
import { scoringConfigFromSeason } from "./scoring";
import { computeReplacementLevels, findInjuryBoosts, forwardRate, gatherPlayerForms, type ValuedPlayer } from "./lib/playerValue";

type Position = (typeof POSITIONS)[number];

export interface RosVorRow {
  fpid: number;
  name: string;
  team: string | null;
  position: Position;
  // Raw underlying value - not meant for display (see schema.ts's comment
  // on why rank is the UI-facing number). Kept here for tooling/debugging
  // and for trade-evaluation math that wants the actual magnitude, not just
  // ordering.
  rosVor: number;
  rosRank: number;
  actualVor: number;
  actualRank: number;
}

// Recomputes and upserts one week's full rosVorSnapshots board for one
// season - called for every season from convex/fetchAllData.ts's daily
// refreshCachedComputations loop, same as draftValues' own per-season
// refresh. Upserted by (seasonId, week, fpid): a same-week rerun (the cron
// runs daily, this is meant to read as weekly) just refreshes that week's
// numbers in place, and a new row per player only appears once the NFL
// week actually advances - same trick convex/infinileague/season/
// powerRankings.ts's snapshot upsert uses, just at per-player instead of
// per-team granularity, and this table (unlike that one) never prunes old
// weeks - the full history is the point (next season's draft prep wants
// every week's board, not just the latest).
export const refreshRosVor = internalMutation({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args) => {
    const settings = await ctx.db.get(args.seasonId);
    if (!settings) return;

    // Same "not currently in an NFL regular season week" guard as
    // convex/lib/faab.ts's computeFaabSuggestions - rosVor is an in-season
    // concept (needs actual playerPoints history, injury freshness tied to
    // a real week), unlike draftValues, which stays meaningful year-round.
    const nflState = await ctx.db.query("nflState").first();
    if (!nflState || nflState.seasonType !== "regular") return;

    const remainingWeeks = Math.max(18 - Number(nflState.week) + 1, 0);
    const activePositions = POSITIONS.filter(
      (pos) => settings.rosterSlots[pos] > 0 || settings.flexPositions.includes(pos) || settings.superflexPositions.includes(pos),
    );
    const scoringConfig = scoringConfigFromSeason(settings);

    const [rosteredRows, forms] = await Promise.all([
      ctx.db
        .query("rosterPlayers")
        .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
        .collect(),
      gatherPlayerForms(ctx, { activePositions, week: nflState.week, scoringConfig }),
    ]);
    const rosteredFpids = new Set(rosteredRows.map((row) => row.fpid));

    // Applied to EVERY player (rostered or not), unlike FAAB's own
    // valueOf, which only boosts the free-agent view - a general "how good
    // is this player right now" ranking should reflect a role bump
    // whether or not anyone happens to already roster them.
    const boosts = await findInjuryBoosts(ctx, { forms });
    const rosValueByFpid = new Map<number, number>();
    for (const form of forms.values()) {
      let value = forwardRate(form) * remainingWeeks;
      const boost = boosts.get(form.fpid);
      if (boost) {
        const boostedWeeks = Math.min(boost.boostedWeeks, remainingWeeks);
        value += Math.max(boost.boostedRate - forwardRate(form), 0) * boostedWeeks;
      }
      rosValueByFpid.set(form.fpid, value);
    }

    // Forward replacement level - free-agent pool ranked by the momentum-
    // adjusted rosValue above.
    const freeAgentsByRosValue = new Map<Position, ValuedPlayer[]>();
    for (const pos of activePositions) {
      const rows = [...forms.values()]
        .filter((form) => form.position === pos && !rosteredFpids.has(form.fpid))
        .map((form) => ({ fpid: form.fpid, name: form.name, team: form.team, position: form.position, rosValue: rosValueByFpid.get(form.fpid) ?? 0 }))
        .sort((a, b) => b.rosValue - a.rosValue);
      freeAgentsByRosValue.set(pos, rows);
    }
    const rosReplacementValues = computeReplacementLevels(settings, activePositions, freeAgentsByRosValue);

    // Backward replacement level - same tiered demand curve, but the pool
    // is ranked by cumulative actual points scored this season instead of
    // rosValue (computeReplacementLevels only cares that its input is
    // sorted by "rosValue" descending, not what that number represents).
    const actualPointsByFpid = new Map<number, number>();
    for (const pos of activePositions) {
      const rows = await ctx.db
        .query("playerSeasonStats")
        .withIndex("by_position_season_scoring_teScoring_sixPointPassTds", (q) =>
          q
            .eq("position", pos)
            .eq("season", nflState.season)
            .eq("scoring", scoringConfig.scoring)
            .eq("teScoring", scoringConfig.teScoring)
            .eq("sixPointPassTds", scoringConfig.sixPointPassTds),
        )
        .collect();
      for (const row of rows) actualPointsByFpid.set(row.fpid, row.totalPoints);
    }
    const freeAgentsByActualPoints = new Map<Position, ValuedPlayer[]>();
    for (const pos of activePositions) {
      const rows = [...forms.values()]
        .filter((form) => form.position === pos && !rosteredFpids.has(form.fpid))
        .map((form) => ({ fpid: form.fpid, name: form.name, team: form.team, position: form.position, rosValue: actualPointsByFpid.get(form.fpid) ?? 0 }))
        .sort((a, b) => b.rosValue - a.rosValue);
      freeAgentsByActualPoints.set(pos, rows);
    }
    const actualReplacementValues = computeReplacementLevels(settings, activePositions, freeAgentsByActualPoints);

    // Global (not per-position) rank for both metrics - a real "overall"
    // fantasy board mixes positions, ranked purely by how far above
    // replacement each player is, which is exactly what VOR puts on a
    // comparable cross-position scale.
    const valued = [...forms.values()].map((form) => ({
      form,
      rosValue: rosValueByFpid.get(form.fpid) ?? 0,
      rosVor: (rosValueByFpid.get(form.fpid) ?? 0) - rosReplacementValues[form.position],
      actualVor: (actualPointsByFpid.get(form.fpid) ?? 0) - actualReplacementValues[form.position],
    }));
    const rosRankByFpid = new Map<number, number>();
    [...valued]
      .sort((a, b) => b.rosVor - a.rosVor)
      .forEach((row, index) => rosRankByFpid.set(row.form.fpid, index + 1));
    const actualRankByFpid = new Map<number, number>();
    [...valued]
      .sort((a, b) => b.actualVor - a.actualVor)
      .forEach((row, index) => actualRankByFpid.set(row.form.fpid, index + 1));

    const existing = await ctx.db
      .query("rosVorSnapshots")
      .withIndex("by_season_week", (q) => q.eq("seasonId", args.seasonId).eq("week", nflState.week))
      .collect();
    const existingByFpid = new Map(existing.map((row) => [row.fpid, row]));
    const now = Date.now();
    const seen = new Set<number>();

    for (const { form, rosValue, rosVor, actualVor } of valued) {
      seen.add(form.fpid);
      const fields = {
        position: form.position,
        name: form.name,
        team: form.team,
        rosValue,
        boostReason: boosts.get(form.fpid)?.reason,
        rosVor,
        rosRank: rosRankByFpid.get(form.fpid) ?? 0,
        actualVor,
        actualRank: actualRankByFpid.get(form.fpid) ?? 0,
        computedAt: now,
      };
      const match = existingByFpid.get(form.fpid);
      if (match) {
        await ctx.db.patch(match._id, fields);
      } else {
        await ctx.db.insert("rosVorSnapshots", {
          seasonId: args.seasonId,
          week: nflState.week,
          fpid: form.fpid,
          ...fields,
        });
      }
    }

    // Drop players who no longer have a current-week projection (e.g. long-
    // term IR) - mirrors upsertProjections' own prune-on-refresh pattern.
    for (const row of existing) {
      if (!seen.has(row.fpid)) {
        await ctx.db.delete(row._id);
      }
    }
  },
});

// One season's full board for a given week, ranked best-first - the UI-
// facing rank fields (rosRank/actualRank), not the raw VOR values, are
// what should actually be shown (see schema.ts's comment).
export const getRosVorBoard = query({
  args: { seasonId: v.id("seasons"), week: v.string(), position: v.optional(positionValidator) },
  handler: async (ctx, args): Promise<RosVorRow[]> => {
    const rows = await ctx.db
      .query("rosVorSnapshots")
      .withIndex("by_season_week", (q) => q.eq("seasonId", args.seasonId).eq("week", args.week))
      .collect();
    return rows
      .filter((row) => !args.position || row.position === args.position)
      .sort((a, b) => a.rosRank - b.rosRank)
      .map((row) => ({
        fpid: row.fpid,
        name: row.name,
        team: row.team,
        position: row.position,
        rosVor: row.rosVor,
        rosRank: row.rosRank,
        actualVor: row.actualVor,
        actualRank: row.actualRank,
      }));
  },
});

// One player's full weekly history for a season, oldest first - "rank vs.
// last week" is just comparing consecutive entries; the full run is what
// next season's draft prep wants (see this file's header comment).
export const getPlayerRosVorHistory = query({
  args: { seasonId: v.id("seasons"), fpid: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("rosVorSnapshots")
      .withIndex("by_season_fpid", (q) => q.eq("seasonId", args.seasonId).eq("fpid", args.fpid))
      .collect();
    return rows.sort((a, b) => Number(a.week) - Number(b.week));
  },
});
