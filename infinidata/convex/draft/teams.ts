import { v } from "convex/values";
import {
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import {
  requireSeasonOwner,
  requireRealDraft,
  requireDraftNotStarted,
} from "./auth";
import { invalidateDraftValues } from "../draftValues";
import { resolveDraftType, type DraftType } from "../draftType";

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

// No-auth counterpart to listSeasonTeams, for server-side callers that have
// already checked ownership themselves - specifically convex/sleeper/
// league.ts's syncLeagueRoster action, which can't call the QueryCtx-typed
// requireSeasonOwner directly (actions only get ActionCtx) and already
// verified the caller owns this season via requireOwnedSeasonForSync before
// reaching this query.
export const listSeasonTeamsInternal = internalQuery({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("seasonTeams")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .collect();
  },
});

// Called once per season, from the Sleeper/Yahoo import wizards (with real
// imported team names/links) or manually from Settings' "Save Teams" form
// for the rare pre-existing season that predates leagues.ts's createLeague
// auto-populating default teams. Creates the owner's own team (isSelf:
// true, order 0) plus one row per opponent name. Throws if this season's
// teams have already been set up, since re-running would duplicate them.
// Also seeds the nomination order to this same entry order (linear mode) so
// a league always has an *active* suggested order from the moment teams
// exist, rather than sitting "manual" until someone visits TeamsPanel and
// clicks Save - "manual" now only happens if a host intentionally clears it
// (see clearNominationOrder).
const sleeperLinkValidator = v.object({
  sleeperRosterId: v.string(),
  sleeperOwnerId: v.string(),
});

// Shared insert logic behind initializeSeasonTeams below, called directly
// (not via ctx.runMutation) so leagues.ts's createLeague can seed a plain
// custom league's default "Team N" rows in the same transaction as the
// league/season/draft it just created, with no separate round trip.
export async function insertSeasonTeams(
  ctx: MutationCtx,
  args: {
    seasonId: Id<"seasons">;
    draftId: Id<"drafts">;
    // Determines whether draftOrder gets seeded below - callers pass this
    // in rather than insertSeasonTeams re-fetching season/draft docs, since
    // both current callers already have what resolveDraftType needs on hand.
    draftType: DraftType;
    selfName: string;
    opponentNames: string[];
    selfSleeperLink?:
      { sleeperRosterId: string; sleeperOwnerId: string } | undefined;
    opponentSleeperLinks?:
      | ({ sleeperRosterId: string; sleeperOwnerId: string } | null)[]
      | undefined;
    selfYahooTeamKey?: string | undefined;
    opponentYahooTeamKeys?: (string | null)[] | undefined;
  },
): Promise<Id<"seasonTeams">> {
  const now = Date.now();
  const selfId = await ctx.db.insert("seasonTeams", {
    seasonId: args.seasonId,
    name: args.selfName,
    isSelf: true,
    order: 0,
    createdAt: now,
    ...(args.selfSleeperLink ?? {}),
    ...(args.selfYahooTeamKey ? { yahooTeamKey: args.selfYahooTeamKey } : {}),
  });
  const teamIds = [selfId];
  for (const [index, name] of args.opponentNames.entries()) {
    const link = args.opponentSleeperLinks?.[index];
    const yahooTeamKey = args.opponentYahooTeamKeys?.[index];
    teamIds.push(
      await ctx.db.insert("seasonTeams", {
        seasonId: args.seasonId,
        name,
        isSelf: false,
        order: index + 1,
        createdAt: now,
        ...(link ?? {}),
        ...(yahooTeamKey ? { yahooTeamKey } : {}),
      }),
    );
  }

  // nominationOrder is set unconditionally - it's meaningless outside a
  // live auction (see schema.ts), so leaving it populated for snake/linear
  // is harmless. draftOrder is the opposite: several pickSlots.ts mutations
  // (tradePickSlot, forfeitPickSlot, restorePickSlot) rely on it being
  // *unset* for auction leagues as their only guard against running there,
  // so it must stay gated on draftType rather than also being unconditional.
  // For snake/linear, draftOrder is a hard precondition rather than a soft
  // suggestion - picks.ts's draftPick throws "Set the draft order before
  // picking" without it - so leaving it unset there would make a freshly
  // created snake/linear league undraftable until a host visited TeamsPanel
  // and saved an order by hand.
  const isAuction = args.draftType === "auction";
  await ctx.db.patch(args.draftId, {
    nominationOrder: teamIds,
    nominationOrderMode: "linear",
    ...(isAuction ? {} : { draftOrder: teamIds }),
  });
  await ctx.db.insert("draftNominationTurns", {
    draftId: args.draftId,
    currentTeamId: selfId,
    direction: 1,
    updatedAt: now,
  });

  return selfId;
}

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
    // convex/yahoo/league.ts's previewYahooImport) - just the team_key
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
