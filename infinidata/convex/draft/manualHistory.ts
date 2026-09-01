import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireSeasonOwner } from "./auth";

// Lets a host backfill or correct keeper-cost history for a prior season -
// either one this app never ran a draft for at all, or one already
// imported from Sleeper/Yahoo but missing/wrong in some way (a player this
// app couldn't match, a bad price, etc.) - see
// src/pages/Settings/components/ManualPreviousSeasonModal.tsx. Creates (or,
// for an already-synthetic season, fully replaces) a prior season/draft the
// exact same way convex/leagues.ts's importPreviousSeasonHistory does for
// provider imports, except every pick is tagged teamAssignmentConfirmed:
// true (the user is directly asserting "this team had this player," not
// just reporting draft-day/roster-snapshot results - see schema.ts's
// comment on that field) and historySource: "manual" going forward,
// regardless of what it was before.
//
// The one season this must never touch is a REAL in-app-played draft's own
// history (historySource left undefined - see schema.ts's comment) -
// overwriting that would silently destroy actual draft results. Anything
// with a historySource at all (sleeper/yahoo/manual) is synthetic/imported
// and fair game to prefill from and replace.

const teamInputValidator = v.object({
  name: v.string(),
  isSelf: v.boolean(),
  players: v.array(
    v.object({
      fpid: v.number(),
      // Exactly one of these two is expected, matching the CURRENT
      // season's format (SNAKE_DRAFT.md §8) - a snake/linear league needs
      // round to feed computeKeeperCostRound, an auction league needs
      // price for computeKeeperCost. See
      // ManualPreviousSeasonModal.tsx's isSnakeOrLinear prop.
      price: v.optional(v.number()),
      round: v.optional(v.number()),
    }),
  ),
});

// Existing history data for `year`, if any - used to pre-fill the edit
// form, whether it was entered here before or imported from a provider.
// Returns null both when no season exists for that year yet AND when one
// exists but is a real in-app-played draft's own history (historySource
// undefined) - there's nothing safe for the manual edit UI to prefill from
// or replace in that case (see this file's header comment).
export const getManualPreviousSeasonEntry = query({
  args: { seasonId: v.id("seasons"), year: v.string() },
  handler: async (ctx, args) => {
    const { league } = await requireSeasonOwner(ctx, args.seasonId);
    const historySeason = await ctx.db
      .query("seasons")
      .withIndex("by_league_year", (q) =>
        q.eq("leagueId", league._id).eq("year", args.year),
      )
      .first();
    if (!historySeason) return null;

    const historyDraft = await ctx.db
      .query("drafts")
      .withIndex("by_season_kind", (q) =>
        q.eq("seasonId", historySeason._id).eq("kind", "real"),
      )
      .first();
    if (!historyDraft || historyDraft.historySource === undefined) return null;

    const teams = await ctx.db
      .query("seasonTeams")
      .withIndex("by_season", (q) => q.eq("seasonId", historySeason._id))
      .collect();
    const picks = await ctx.db
      .query("draftPicks")
      .withIndex("by_draft", (q) => q.eq("draftId", historyDraft._id))
      .collect();
    const picksByTeamId = new Map<Id<"seasonTeams">, typeof picks>();
    for (const pick of picks) {
      const list = picksByTeamId.get(pick.teamId) ?? [];
      list.push(pick);
      picksByTeamId.set(pick.teamId, list);
    }

    return {
      teams: teams
        .sort((a, b) => a.order - b.order)
        .map((team) => ({
          name: team.name,
          isSelf: team.isSelf,
          players: (picksByTeamId.get(team._id) ?? []).map((pick) => ({
            fpid: pick.fpid,
            // Whichever of these is actually populated depends on what
            // format this history was recorded/imported under - could be
            // neither (SNAKE_DRAFT.md §9's forfeited-slot precedent) but
            // never both. The edit form picks whichever one matches the
            // CURRENT season's format (isSnakeOrLinear).
            price: pick.price,
            round: pick.round,
          })),
        })),
    };
  },
});

// Creates (or, if `year` already has a synthetic season - imported or
// manually-entered - fully replaces) this league's history for that year.
// Full-replace rather than a diff - the edit form always resubmits its
// whole current state, same as e.g. TeamsPanel's nomination-order Save - so
// a typo fix or a team reassignment is just "change the row, submit
// again." Re-tags the draft historySource: "manual" regardless of what it
// was before - once a host has directly edited/confirmed it here, it's
// manual data going forward, not "whatever Sleeper/Yahoo happened to send."
export const setManualPreviousSeasonResults = mutation({
  args: {
    seasonId: v.id("seasons"),
    year: v.string(),
    teams: v.array(teamInputValidator),
  },
  handler: async (ctx, args) => {
    const { season: current, league } = await requireSeasonOwner(
      ctx,
      args.seasonId,
    );

    const existingSeason = await ctx.db
      .query("seasons")
      .withIndex("by_league_year", (q) =>
        q.eq("leagueId", league._id).eq("year", args.year),
      )
      .first();

    const now = Date.now();
    let historySeasonId: Id<"seasons">;
    let historyDraftId: Id<"drafts">;

    if (existingSeason) {
      const existingDraft = await ctx.db
        .query("drafts")
        .withIndex("by_season_kind", (q) =>
          q.eq("seasonId", existingSeason._id).eq("kind", "real"),
        )
        .first();
      if (!existingDraft || existingDraft.historySource === undefined) {
        throw new Error(
          `This league already has a real ${args.year} season, so it can't be overwritten this way.`,
        );
      }
      historySeasonId = existingSeason._id;
      historyDraftId = existingDraft._id;
      if (existingDraft.historySource !== "manual") {
        await ctx.db.patch(existingDraft._id, {
          historySource: "manual",
          name: `${league.name} (Manually entered ${args.year})`,
        });
      }

      const oldTeams = await ctx.db
        .query("seasonTeams")
        .withIndex("by_season", (q) => q.eq("seasonId", historySeasonId))
        .collect();
      for (const team of oldTeams) {
        await ctx.db.delete(team._id);
      }
      const oldPicks = await ctx.db
        .query("draftPicks")
        .withIndex("by_draft", (q) => q.eq("draftId", historyDraftId))
        .collect();
      for (const pick of oldPicks) {
        await ctx.db.delete(pick._id);
      }
    } else {
      historySeasonId = await ctx.db.insert("seasons", {
        leagueId: league._id,
        year: args.year,
        teamCount: args.teams.length,
        salaryCap: current.salaryCap,
        scoring: current.scoring,
        ...(current.teScoring !== undefined
          ? { teScoring: current.teScoring }
          : {}),
        ...(current.sixPointPassTds !== undefined
          ? { sixPointPassTds: current.sixPointPassTds }
          : {}),
        rosterSlots: current.rosterSlots,
        flexPositions: current.flexPositions,
        superflexPositions: current.superflexPositions,
        createdAt: now,
      });
      historyDraftId = await ctx.db.insert("drafts", {
        seasonId: historySeasonId,
        kind: "real",
        name: `${league.name} (Manually entered ${args.year})`,
        status: "complete",
        historySource: "manual",
        createdAt: now,
      });
    }

    let sequence = 0;
    for (const [index, team] of args.teams.entries()) {
      const teamId = await ctx.db.insert("seasonTeams", {
        seasonId: historySeasonId,
        name: team.name,
        isSelf: team.isSelf,
        order: index,
        createdAt: now,
      });
      for (const player of team.players) {
        // Same "skip anything this app has no identity/position record for"
        // rule as importPreviousSeasonHistory - draftPicks.position is
        // required and there's nowhere else to source it from.
        const playerDoc = await ctx.db
          .query("players")
          .withIndex("by_fpid", (q) => q.eq("fpid", player.fpid))
          .first();
        if (!playerDoc) continue;
        sequence += 1;
        await ctx.db.insert("draftPicks", {
          draftId: historyDraftId,
          sequence,
          fpid: player.fpid,
          position: playerDoc.position,
          teamId,
          teamAssignmentConfirmed: true,
          createdAt: now,
          ...(player.round !== undefined ? { round: player.round } : {}),
          ...(player.price !== undefined ? { price: player.price } : {}),
        });
      }
    }

    return historySeasonId;
  },
});
