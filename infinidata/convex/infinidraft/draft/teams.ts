import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import {
  requireSeasonOwner,
  requireRealDraft,
  requireDraftNotStarted,
} from "../../lib/access";
import { insertSeasonTeams } from "../../lib/seasonTeams";
import { invalidateDraftValues } from "../../draftValues";
import { resolveDraftType } from "../../draftType";

export const listSeasonTeams = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args) => {
    await requireSeasonOwner(ctx, args.seasonId);
    const teams = await ctx.db
      .query("seasonTeams")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .collect();
    return teams.sort((a, b) => a.order - b.order);
  },
});

// Read-only, no-ownership-check counterpart to listSeasonTeams for the TV
// board (src/pages/DraftBoard/DraftBoard.tsx) - meant to be viewable by
// anyone with the link, not just the league's owner (see
// convex/leagues.ts's getSeasonPublic for the same reasoning).
export const listSeasonTeamsPublic = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args) => {
    const teams = await ctx.db
      .query("seasonTeams")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .collect();
    return teams.sort((a, b) => a.order - b.order);
  },
});

// Called once per season, from the Sleeper/Yahoo import wizards (with real
// imported team names/links) or manually from Settings' "Save Teams" form
// for the rare pre-existing season that predates leagues.ts's createLeague
// auto-populating default teams. Creates the owner's own team via the
// shared convex/lib/seasonTeams.ts helper. Throws if this season's teams
// have already been set up, since re-running would duplicate them.
const sleeperLinkValidator = v.object({
  sleeperRosterId: v.string(),
  sleeperOwnerId: v.string(),
});

export const initializeSeasonTeams = mutation({
  args: {
    seasonId: v.id("seasons"),
    opponentNames: v.array(v.string()),
    selfName: v.string(),
    // Set by the "Import from Sleeper" creation wizard so an imported
    // league's teams already carry their sync links from creation - no
    // separate team-mapping pass needed later in Season Settings (convex/
    // sleeper/league.ts's syncLeagueRoster). Absent for the normal
    // manual-setup flow. opponentSleeperLinks, when given, is parallel to
    // opponentNames (null entries for any unmatched team).
    selfSleeperLink: v.optional(sleeperLinkValidator),
    opponentSleeperLinks: v.optional(
      v.array(v.union(sleeperLinkValidator, v.null())),
    ),
    // Yahoo equivalent, set by the "Import from Yahoo" creation wizard (see
    // convex/infinidraft/yahoo/league.ts's previewYahooImport) - just the team_key
    // string, since Yahoo has no separate roster/owner id split the way
    // Sleeper's link does (see seasonTeams.yahooTeamKey's schema comment).
    selfYahooTeamKey: v.optional(v.string()),
    opponentYahooTeamKeys: v.optional(v.array(v.union(v.string(), v.null()))),
  },
  handler: async (ctx, args) => {
    const { season, draft } = await requireDraftNotStarted(ctx, args.seasonId);

    const existing = await ctx.db
      .query("seasonTeams")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .first();
    if (existing) {
      throw new Error("Teams have already been set up for this draft.");
    }

    if (args.opponentNames.length !== season.teamCount - 1) {
      throw new Error(
        `This league has ${season.teamCount} teams, so ${
          season.teamCount - 1
        } opponent names are required (got ${args.opponentNames.length}).`,
      );
    }

    return await insertSeasonTeams(ctx, {
      seasonId: args.seasonId,
      draftId: draft._id,
      draftType: resolveDraftType(season, draft),
      selfName: args.selfName,
      opponentNames: args.opponentNames,
      selfSleeperLink: args.selfSleeperLink,
      opponentSleeperLinks: args.opponentSleeperLinks,
      selfYahooTeamKey: args.selfYahooTeamKey,
      opponentYahooTeamKeys: args.opponentYahooTeamKeys,
    });
  },
});

// Adds one new non-self team - the increase-teamCount counterpart to
// removeSeasonTeam below (see that mutation's comment for the full
// reconciliation story; convex/leagues.ts's updateSeason rejects editing
// teamCount directly once teams exist and points here/there instead).
// Appends to the end of both team `order` and, when one's active, the
// nomination order, so a newly-added team is immediately in the rotation
// rather than needing a separate step to include it.
export const addSeasonTeam = mutation({
  args: { seasonId: v.id("seasons"), name: v.string() },
  handler: async (ctx, args) => {
    const { season, draft } = await requireDraftNotStarted(ctx, args.seasonId);

    const name = args.name.trim();
    if (!name) {
      throw new Error("Team name can't be empty.");
    }

    const teams = await ctx.db
      .query("seasonTeams")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .collect();

    const teamId = await ctx.db.insert("seasonTeams", {
      seasonId: args.seasonId,
      name,
      isSelf: false,
      order: teams.length,
      createdAt: Date.now(),
    });

    await ctx.db.patch(season._id, { teamCount: teams.length + 1 });

    if (draft.nominationOrder) {
      await ctx.db.patch(draft._id, {
        nominationOrder: [...draft.nominationOrder, teamId],
      });
    }
    if (draft.draftOrder) {
      await ctx.db.patch(draft._id, {
        draftOrder: [...draft.draftOrder, teamId],
      });
    }

    // This team's cap adds to the $ value engine's total auction pool size
    // (see convex/draftValues.ts), same invalidation removeSeasonTeam
    // triggers for the opposite direction.
    await invalidateDraftValues(ctx, draft._id);
    return teamId;
  },
});

// Removes one non-self team - lets a commissioner bring seasonTeams back in
// sync after reducing "Teams" in League Settings, which today just patches
// seasons.teamCount without touching the team rows at all (see updateSeason
// in convex/leagues.ts, which now refuses to save further edits while the
// two are out of sync). Refuses if the team already has draft picks, since
// a drafted player has nowhere to go once its team is gone - remove the
// picks first (League tab) if this team already drafted anyone.
export const removeSeasonTeam = mutation({
  args: { teamId: v.id("seasonTeams") },
  handler: async (ctx, args) => {
    const team = await ctx.db.get(args.teamId);
    if (!team) {
      throw new Error("Team not found.");
    }
    if (team.isSelf) {
      throw new Error("Can't remove your own team.");
    }
    const { season, draft } = await requireDraftNotStarted(ctx, team.seasonId);

    const teams = await ctx.db
      .query("seasonTeams")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect();
    if (teams.length <= 2) {
      throw new Error("A league needs at least 2 teams.");
    }

    const picks = await ctx.db
      .query("draftPicks")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .filter((q) => q.eq(q.field("teamId"), args.teamId))
      .collect();
    if (picks.length > 0) {
      throw new Error(
        "This team already has draft picks - remove those (League tab) before deleting the team.",
      );
    }

    for (const row of await ctx.db
      .query("rosterPlayers")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect()) {
      await ctx.db.delete(row._id);
    }
    await ctx.db.delete(args.teamId);

    // Renumber the remaining teams' `order` to stay contiguous, and keep
    // seasons.teamCount in lockstep with the actual rows from here on.
    const remaining = teams
      .filter((t) => t._id !== args.teamId)
      .sort((a, b) => a.order - b.order);
    for (const [index, t] of remaining.entries()) {
      if (t.order !== index) await ctx.db.patch(t._id, { order: index });
    }
    await ctx.db.patch(season._id, { teamCount: remaining.length });

    if (draft.nominationOrder?.includes(args.teamId)) {
      await ctx.db.patch(draft._id, {
        nominationOrder: draft.nominationOrder.filter(
          (id) => id !== args.teamId,
        ),
      });
    }
    if (draft.draftOrder?.includes(args.teamId)) {
      await ctx.db.patch(draft._id, {
        draftOrder: draft.draftOrder.filter((id) => id !== args.teamId),
      });
    }
    const turn = await ctx.db
      .query("draftNominationTurns")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .first();
    if (turn && turn.currentTeamId === args.teamId) {
      await ctx.db.patch(turn._id, {
        currentTeamId: remaining[0]?._id ?? null,
      });
    }

    // This team's cap contributed to the $ value engine's total auction
    // pool size (see convex/draftValues.ts), same invalidation a
    // league-settings edit already triggers.
    await invalidateDraftValues(ctx, draft._id);
    return null;
  },
});

export const renameSeasonTeam = mutation({
  args: { teamId: v.id("seasonTeams"), name: v.string() },
  handler: async (ctx, args) => {
    const team = await ctx.db.get(args.teamId);
    if (!team) {
      throw new Error("Team not found.");
    }
    await requireSeasonOwner(ctx, team.seasonId);
    await ctx.db.patch(args.teamId, { name: args.name });
    return await ctx.db.get(args.teamId);
  },
});

// null clears the override back to the league default (seasons.salaryCap).
export const setTeamSalaryCap = mutation({
  args: {
    teamId: v.id("seasonTeams"),
    salaryCap: v.union(v.number(), v.null()),
  },
  handler: async (ctx, args) => {
    const team = await ctx.db.get(args.teamId);
    if (!team) {
      throw new Error("Team not found.");
    }
    await requireSeasonOwner(ctx, team.seasonId);
    if (args.salaryCap !== null && args.salaryCap <= 0) {
      throw new Error("Salary cap must be a positive number.");
    }
    await ctx.db.patch(args.teamId, {
      salaryCapOverride: args.salaryCap ?? undefined,
    });
    // This team's override feeds the $ value engine's total auction pool
    // size (see convex/draftValues.ts), so the cache needs the same
    // invalidation a league-settings edit already triggers.
    const draft = await requireRealDraft(ctx, team.seasonId);
    await invalidateDraftValues(ctx, draft._id);
    return await ctx.db.get(args.teamId);
  },
});

// Links (or unlinks, passing null for both) this team to a real Sleeper
// roster/owner - the one-time mapping step in Settings that syncLeagueRoster
// (convex/sleeper/league.ts) depends on to know which synced roster belongs
// to which app team.
export const setTeamSleeperLink = mutation({
  args: {
    teamId: v.id("seasonTeams"),
    sleeperRosterId: v.union(v.string(), v.null()),
    sleeperOwnerId: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const team = await ctx.db.get(args.teamId);
    if (!team) {
      throw new Error("Team not found.");
    }
    await requireSeasonOwner(ctx, team.seasonId);
    await ctx.db.patch(args.teamId, {
      sleeperRosterId: args.sleeperRosterId ?? undefined,
      sleeperOwnerId: args.sleeperOwnerId ?? undefined,
    });
    return await ctx.db.get(args.teamId);
  },
});

// Yahoo equivalent of setTeamSleeperLink above.
export const setTeamYahooLink = mutation({
  args: {
    teamId: v.id("seasonTeams"),
    yahooTeamKey: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const team = await ctx.db.get(args.teamId);
    if (!team) {
      throw new Error("Team not found.");
    }
    await requireSeasonOwner(ctx, team.seasonId);
    await ctx.db.patch(args.teamId, {
      yahooTeamKey: args.yahooTeamKey ?? undefined,
    });
    return await ctx.db.get(args.teamId);
  },
});

// null clears the override back to the league default (seasons.faabBudget).
export const setTeamFaabBudget = mutation({
  args: {
    teamId: v.id("seasonTeams"),
    faabBudget: v.union(v.number(), v.null()),
  },
  handler: async (ctx, args) => {
    const team = await ctx.db.get(args.teamId);
    if (!team) {
      throw new Error("Team not found.");
    }
    await requireSeasonOwner(ctx, team.seasonId);
    if (args.faabBudget !== null && args.faabBudget < 0) {
      throw new Error("FAAB budget can't be negative.");
    }
    await ctx.db.patch(args.teamId, {
      faabBudgetOverride: args.faabBudget ?? undefined,
    });
    return await ctx.db.get(args.teamId);
  },
});
